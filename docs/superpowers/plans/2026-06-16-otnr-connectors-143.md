# OTNR Connectors 143 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve still-reproducing, safe connector MED/LOW findings from issue #143 on branch `otnr-connectors-143`.

**Architecture:** Keep changes inside `packages/connectors` plus focused integration tests. Treat issue #143 + `/home/ben/Jarv1s/docs/audit/otnr/phase-11-module-connectors.md` as the spec; do not edit applied migrations. Use runtime shape guards at the secret boundary, manifest metadata cleanup, in-process single-flight for token refresh, and route helper dedup without changing public DTOs.

**Tech Stack:** TypeScript, Fastify route tests, Vitest integration tests, Kysely/DataContextDb, Postgres RLS.

---

## Relevance Check

Grounded after `pnpm audit:preflight` at `HEAD=3feb8d6`; focused baselines:

- `pnpm test:connectors` -> 12 passed after sequential run.
- `pnpm exec vitest run tests/integration/connectors-google.test.ts tests/integration/api-rate-limit.test.ts` -> 27 passed after sequential run.
- Initial parallel baseline was invalid: both suites reset the same DB concurrently, causing pg-boss/schema races.

Still reproduces and safe in this lane:

- `packages/connectors/src/manifest.ts`: stale `database.migrations` metadata and missing `app.connector_oauth_pending` in `ownedTables`.
- `packages/connectors/src/google-connection.ts`: decrypted Google pending/account secrets are cast without runtime shape validation.
- `packages/connectors/src/google-connection.ts`: `getFreshAccessToken` has no per-account refresh single-flight.
- `packages/connectors/src/routes.ts`: duplicate object validators and duplicate nullable/non-null date coercers.

Stale; skip:

- `updateAccount` revoked reset: current `packages/connectors/src/repository.ts` only clears `revoked_at` when a non-revoked `status` is explicitly supplied.
- `requireAdmin` root `appDb`: current route dependencies no longer include `appDb`; admin check uses `ConnectorsRepository.getUserById(scopedDb, ...)` inside `withDataContext`.
- `packages/connectors/src/crypto.ts` current-key non-null assertion: connector cipher now delegates to `@jarv1s/db` `JsonSecretCipher`, which explicitly throws when current key is absent.

Still present but stop/escalate before changing:

- `packages/connectors/sql/0010_connector_admin_safe_metadata.sql` policies `TO jarvis_migration_owner`. Current `app.list_connector_account_safe_metadata()` is `SECURITY DEFINER` and connector tables are `FORCE ROW LEVEL SECURITY`; dropping the policies may break the sole admin metadata function. Fix requires security/DB ownership decision and likely a new migration, so this lane reports it rather than guessing.

## File Structure

- Modify `packages/connectors/src/manifest.ts`: regenerate the required `migrations` array and add `app.connector_oauth_pending` to `ownedTables`.
- Modify `tests/integration/connectors.test.ts`: update manifest metadata assertion.
- Modify `packages/connectors/src/google-connection.ts`: add narrow decrypt validators and per-account refresh single-flight.
- Modify `tests/integration/connectors-google.test.ts`: add red/green coverage for malformed pending secret, malformed stored account secret, and concurrent refresh dedupe.
- Modify `packages/connectors/src/routes.ts`: collapse `requireObject`/`requiredJsonObject`; collapse date helpers.
- Modify `tests/integration/api-rate-limit.test.ts`: add route throttle regression for `/api/connectors/google/authorize` only if coordinator expands scope to include issue #138; otherwise do not touch.

## Task 1: Manifest Metadata

**Files:**

- Modify: `packages/connectors/src/manifest.ts`
- Modify: `tests/integration/connectors.test.ts`

- [ ] **Step 1: Write failing test**

Change the manifest assertion in `tests/integration/connectors.test.ts`:

```ts
expect(manifest?.database?.ownedTables).toEqual([
  "app.connector_definitions",
  "app.connector_accounts",
  "app.connector_oauth_pending"
]);
expect(manifest?.database?.migrations).toEqual([
  "sql/0009_connectors_module.sql",
  "sql/0010_connector_admin_safe_metadata.sql",
  "sql/0022_connectors_owner_only.sql",
  "sql/0043_connector_google_enum.sql",
  "sql/0044_google_unified_connection.sql",
  "sql/0069_connector_worker_runtime_grants.sql"
]);
```

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm exec vitest run tests/integration/connectors.test.ts -t "loads the built-in Connectors module manifest"
```

Expected: FAIL because current manifest has a stale `database.migrations` list and lacks `app.connector_oauth_pending`.

- [ ] **Step 3: Implement minimal fix**

In `packages/connectors/src/manifest.ts`, set:

```ts
migrations: [
  "sql/0009_connectors_module.sql",
  "sql/0010_connector_admin_safe_metadata.sql",
  "sql/0022_connectors_owner_only.sql",
  "sql/0043_connector_google_enum.sql",
  "sql/0044_google_unified_connection.sql",
  "sql/0069_connector_worker_runtime_grants.sql"
],
```

and set:

```ts
ownedTables: ["app.connector_definitions", "app.connector_accounts", "app.connector_oauth_pending"];
```

- [ ] **Step 4: Verify green**

Run same Vitest command. Expected: PASS.

## Task 2: Google Secret Shape Validation

**Files:**

- Modify: `packages/connectors/src/google-connection.ts`
- Modify: `tests/integration/connectors-google.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests under `describe("GoogleConnectionService", ...)`:

```ts
it("completeAuthorization rejects malformed pending credentials with GoogleConnectError", async () => {
  const service = new GoogleConnectionService({
    repository: new ConnectorsRepository(),
    cipher: createConnectorSecretCipher(),
    oauthClient: new GoogleOAuthClient(),
    generateState: () => "bad-pending"
  });
  await dataContext.withDataContext(userA(), (db) =>
    new ConnectorsRepository().upsertGooglePending(db, {
      state: "bad-pending",
      encryptedSecret: createConnectorSecretCipher().encryptJson({ clientId: "cid" })
    })
  );

  await expect(
    dataContext.withDataContext(userA(), (db) =>
      service.completeAuthorization(db, {
        redirectUrl: "http://localhost:1/?code=4/abc&state=bad-pending"
      })
    )
  ).rejects.toThrow(GoogleConnectError);
});

it("getFreshAccessToken rejects malformed stored google credentials with GoogleConnectError", async () => {
  const service = new GoogleConnectionService({
    repository: new ConnectorsRepository(),
    cipher: createConnectorSecretCipher(),
    oauthClient: new GoogleOAuthClient()
  });
  await dataContext.withDataContext(userA(), (db) =>
    new ConnectorsRepository().upsertGoogleAccount(db, {
      scopes: ["https://www.googleapis.com/auth/calendar"],
      encryptedSecret: createConnectorSecretCipher().encryptJson({
        kind: "google-oauth",
        clientId: "cid",
        clientSecret: "sec",
        accessToken: "at",
        tokenExpiry: new Date(Date.now() - 60_000).toISOString(),
        grantedScopes: ["https://www.googleapis.com/auth/calendar"]
      })
    })
  );

  await expect(
    dataContext.withDataContext(userA(), (db) => service.getFreshAccessToken(db))
  ).rejects.toThrow(GoogleConnectError);
});
```

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm exec vitest run tests/integration/connectors-google.test.ts -t "malformed"
```

Expected: FAIL because malformed secrets currently flow to OAuth calls or undefined fields.

- [ ] **Step 3: Implement minimal fix**

Add local guards in `packages/connectors/src/google-connection.ts`:

```ts
interface GooglePendingCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

function decryptPendingCredentials(
  cipher: ConnectorSecretCipher,
  secret: Parameters<ConnectorSecretCipher["decryptJson"]>[0]
): GooglePendingCredentials {
  const value = cipher.decryptJson(secret);
  if (typeof value.clientId !== "string" || typeof value.clientSecret !== "string") {
    throw new GoogleConnectError("Stored Google authorization credentials are invalid");
  }
  return { clientId: value.clientId, clientSecret: value.clientSecret };
}

function decryptGoogleConnectionSecret(
  cipher: ConnectorSecretCipher,
  secret: Parameters<ConnectorSecretCipher["decryptJson"]>[0]
): GoogleConnectionSecret {
  const value = cipher.decryptJson(secret);
  if (
    value.kind !== "google-oauth" ||
    typeof value.clientId !== "string" ||
    typeof value.clientSecret !== "string" ||
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string" ||
    typeof value.tokenExpiry !== "string" ||
    Number.isNaN(Date.parse(value.tokenExpiry)) ||
    !Array.isArray(value.grantedScopes) ||
    !value.grantedScopes.every((scope) => typeof scope === "string")
  ) {
    throw new GoogleConnectError("Stored Google connection credentials are invalid");
  }
  return value as GoogleConnectionSecret;
}
```

Use those helpers at both decrypt call sites.

- [ ] **Step 4: Verify green**

Run same malformed-focused Vitest command. Expected: PASS.

## Task 3: Google Refresh Single-Flight

**Files:**

- Modify: `packages/connectors/src/google-connection.ts`
- Modify: `tests/integration/connectors-google.test.ts`

- [ ] **Step 1: Write failing test**

Add under `describe("GoogleConnectionService", ...)`:

```ts
it("deduplicates concurrent refreshes for the same google account", async () => {
  let refreshCalls = 0;
  const oauthClient = new GoogleOAuthClient({
    fetchFn: (async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("grant_type=refresh_token")) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: body.includes("grant_type=refresh_token")
            ? "single-flight-at"
            : "initial-at",
          refresh_token: "rt",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar",
          token_type: "Bearer"
        }),
        text: async () => ""
      };
    }) as unknown as typeof fetch
  });
  const service = new GoogleConnectionService({
    repository: new ConnectorsRepository(),
    cipher: createConnectorSecretCipher(),
    oauthClient,
    generateState: () => "single-flight",
    now: () => new Date("2026-06-16T00:00:00.000Z")
  });
  await dataContext.withDataContext(userA(), (db) =>
    service.startAuthorization(db, { clientId: "cid", clientSecret: "sec" })
  );
  await dataContext.withDataContext(userA(), (db) =>
    service.completeAuthorization(db, {
      redirectUrl: "http://localhost:1/?code=4/abc&state=single-flight"
    })
  );

  const results = await Promise.all([
    dataContext.withDataContext(userA(), (db) => service.getFreshAccessToken(db, { force: true })),
    dataContext.withDataContext(userA(), (db) => service.getFreshAccessToken(db, { force: true }))
  ]);

  expect(results).toEqual(["single-flight-at", "single-flight-at"]);
  expect(refreshCalls).toBe(1);
});
```

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm exec vitest run tests/integration/connectors-google.test.ts -t "deduplicates concurrent refreshes"
```

Expected: FAIL because current service refreshes twice.

- [ ] **Step 3: Implement minimal fix**

Add private in-flight map to `GoogleConnectionService`:

```ts
private readonly refreshes = new Map<string, Promise<string>>();
```

After determining refresh is needed, key by `stored.id`:

```ts
const existingRefresh = this.refreshes.get(stored.id);
if (existingRefresh) return existingRefresh;

const refresh = this.refreshAndStoreAccessToken(scopedDb, bundle);
this.refreshes.set(stored.id, refresh);
try {
  return await refresh;
} finally {
  this.refreshes.delete(stored.id);
}
```

Extract existing refresh/write body into `refreshAndStoreAccessToken`.

- [ ] **Step 4: Verify green**

Run same single-flight Vitest command. Expected: PASS.

## Task 4: Route Helper Dedup

**Files:**

- Modify: `packages/connectors/src/routes.ts`
- Existing tests: `tests/integration/connectors.test.ts`, `tests/integration/connectors-google.test.ts`

- [ ] **Step 1: Refactor object helper**

Replace `requiredJsonObject` with:

```ts
function requireObject(value: unknown, fieldName = "body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const message =
      fieldName === "body" ? "Expected JSON object body" : `${fieldName} must be a JSON object`;
    throw new HttpError(400, message);
  }

  return value as Record<string, unknown>;
}
```

Use `requireObject(value.tokenPayload, "tokenPayload")` in create/update parsers.

- [ ] **Step 2: Refactor date helper**

Replace `serializeDate`/`toIsoString` with:

```ts
function serializeNullableDate(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function serializeRequiredDate(value: Date | string): string {
  return serializeNullableDate(value) ?? "";
}
```

Use `serializeRequiredDate` for non-null provider/account dates and `serializeNullableDate` for `revoked_at`.

- [ ] **Step 3: Verify route behavior unchanged**

Run:

```bash
pnpm exec vitest run tests/integration/connectors.test.ts tests/integration/connectors-google.test.ts
```

Expected: PASS.

## Task 5: Focused + Lane Checks

**Files:**

- No edits.

- [ ] **Step 1: Run connector-focused tests**

```bash
pnpm exec vitest run tests/integration/connectors.test.ts tests/integration/connectors-google.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run rate-limit test only if `/authorize` rate-limit scope is approved**

```bash
pnpm exec vitest run tests/integration/api-rate-limit.test.ts -t "authorize"
```

Expected: PASS if scope included; otherwise skip and report #138 is outside #143.

- [ ] **Step 3: Run package/root checks before wrap-up**

```bash
pnpm --filter @jarv1s/connectors typecheck
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: PASS.

## Self-Review

- Spec coverage: covers all still-reproducing safe #143 MED/LOW items; skips stale items; escalates admin-metadata RLS because current forced-RLS/security-definer behavior makes the suggested drop unsafe without decision.
- Placeholder scan: no `TBD`, `TODO`, or unresolved implementation step.
- Type consistency: uses `ConnectorSecretCipher`, `GoogleConnectionSecret`, `GoogleConnectError`, `ConnectorAccountSafeRow`, and current snake_case repository row shape.
