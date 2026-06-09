# M-B1 Google Connector (per-user OAuth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user connect their own Google account (Gmail + Calendar, read+write) to Jarv1s via per-user OAuth, guided from Settings and by Jarvis in chat, storing one encrypted refreshable credential — proven by a live round-trip against real Google.

**Architecture:** Build on the existing `connectors` module (encrypted `connector_accounts` secret + owner-only RLS already exist). Add (1) a unified `google` Connection provider + a short-lived pending-auth table, (2) a dependency-injected `GoogleOAuthClient` (auth-URL / code-exchange / refresh) so tests never call Google, (3) a `GoogleConnectionService` + two REST endpoints (`/authorize`, `/complete`) using the loopback-copy-paste flow, (4) a Settings "Connect Google" panel, (5) a read-only `connectors.startGoogleGuidance` assistant-tool so Jarvis can walk the user through it (secret-paste stays on the Settings REST path). Sync into the read caches and briefing grounding are **out of scope** (downstream slice).

**Tech Stack:** TypeScript, Fastify, Kysely + Postgres (RLS), Vitest (integration via `server.inject` + `withDataContext`), React + React Query (web), Playwright (e2e). Node `fetch` for Google calls (injected for tests). AES-256-GCM via the existing `ConnectorSecretCipher`.

---

## Key design decisions for Coordinator review (resolve before build)

These are the spots where "measure twice" matters — flagged for the Coordinator's review:

1. **Unified-connection schema.** A new `'google'` value on the `app.connector_provider_type` enum + a seeded `provider_id='google'` definition represents the one Connection that enables both services. Because `ALTER TYPE … ADD VALUE` cannot be _used_ in the same transaction it's added, the enum change and its first use are **split across two migration files** (`0040` adds the value, `0041` seeds/uses it). Existing `google-calendar`/`google-email` definitions are **left intact** (the deferred sync slice reconciles them). _Alternative considered:_ a non-enum marker column to avoid the two-file dance — rejected as less honest, but open to the Coordinator's call.
2. **Pending-auth storage.** A dedicated short-lived `app.connector_oauth_pending` table (owner-only) holds `{state, encrypted{clientId,clientSecret}}` between `/authorize` and `/complete` — restart-safe, secrets sent once, no `pending` status added to the accounts enum. _Alternative:_ a `pending` account status — rejected to keep the accounts table clean.
3. **Loopback redirect constant** `http://localhost:1` (matches Hermes; the browser is _expected_ to fail loading it; only the human relays the `?code=` URL). No inbound callback is ever served.
4. **Scopes:** `gmail.modify` + `calendar` from first consent (read+write, least-privilege that still sends/writes).

---

## File structure

**Create:**

- `packages/connectors/sql/0040_connector_google_enum.sql` — adds `'google'` enum value only.
- `packages/connectors/sql/0041_google_unified_connection.sql` — seeds `google` provider, creates `connector_oauth_pending`, grants/RLS, sets read+write `default_scopes`.
- `packages/connectors/src/oauth.ts` — `GoogleOAuthClient` (auth URL, code exchange, refresh) + `GoogleConnectionSecret` type + `parseRedirectUrl`.
- `packages/connectors/src/google-connection.ts` — `GoogleConnectionService` orchestrating cipher + oauth + repository.
- `tests/integration/connectors-google.test.ts` — integration tests (faked Google).
- `scripts/verify-google-connection.ts` — the #12 live round-trip harness (read + reversible write).
- `apps/web/src/connectors/connect-google-panel.tsx` — Settings "Connect Google" UI.
- `tests/e2e/connect-google.spec.ts` — e2e for the Settings flow (mocked REST).

**Modify:**

- `packages/db/src/types.ts` — add `'google'` to `ConnectorProviderType`; add `ConnectorOauthPendingTable` + register in `JarvisDatabase`.
- `packages/connectors/src/repository.ts` — add pending + unified-google account methods.
- `packages/connectors/src/routes.ts` — add `/api/connectors/google/authorize` + `/complete` handlers.
- `packages/connectors/src/manifest.ts` — declare the `connectors.startGoogleGuidance` assistant tool; register the new SQL files if the manifest lists them.
- `packages/connectors/src/index.ts` — export the new modules.
- `packages/shared/src/connectors-api.ts` — add request/response DTOs + route schemas for the two endpoints.
- `apps/web/src/api/client.ts` — add `authorizeGoogleConnection` / `completeGoogleConnection`.
- `apps/web/src/api/query-keys.ts` — reuse `connectors.accounts`.
- `apps/web/src/settings/settings-page.tsx` — render `<ConnectGooglePanel/>`.
- `tests/e2e/mock-api.ts` — handle the two new routes.

---

## Phase 1 — Backend connection foundation

### Task 1: Migration — add the `google` provider enum value

**Files:**

- Create: `packages/connectors/sql/0040_connector_google_enum.sql`

- [ ] **Step 1: Write the migration (enum value only — no use in this file)**

```sql
-- 0040: add the unified 'google' provider type. MUST be its own migration file:
-- Postgres forbids USING a newly ALTER-added enum value in the same transaction it
-- was added, so the seed/use lives in 0041 (a separate file = separate transaction).
ALTER TYPE app.connector_provider_type ADD VALUE IF NOT EXISTS 'google';
```

- [ ] **Step 2: Apply and verify**

Run: `pnpm db:up && pnpm db:migrate`
Expected: migrate completes; `0040_connector_google_enum` recorded in `app.schema_migrations`.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/sql/0040_connector_google_enum.sql
git commit -m "feat(connectors): migration 0040 — add unified google provider enum value"
```

### Task 2: Migration — seed google provider + pending-auth table

**Files:**

- Create: `packages/connectors/sql/0041_google_unified_connection.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0041: unified Google Connection (uses the 'google' enum value added in 0040).

-- Seed the unified Google provider with read+write scopes.
INSERT INTO app.connector_definitions (provider_id, provider_type, display_name, status, default_scopes)
VALUES (
  'google',
  'google',
  'Google',
  'available',
  ARRAY[
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar'
  ]::text[]
)
ON CONFLICT (provider_id) DO UPDATE SET
  provider_type = excluded.provider_type,
  display_name = excluded.display_name,
  status = excluded.status,
  default_scopes = excluded.default_scopes,
  updated_at = now();

-- Short-lived in-flight authorization state (between /authorize and /complete).
CREATE TABLE IF NOT EXISTS app.connector_oauth_pending (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  provider_id text NOT NULL REFERENCES app.connector_definitions(provider_id),
  state text NOT NULL CHECK (length(btrim(state)) > 0),
  encrypted_secret jsonb NOT NULL CHECK (jsonb_typeof(encrypted_secret) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, provider_id)
);

CREATE INDEX IF NOT EXISTS connector_oauth_pending_owner_idx
  ON app.connector_oauth_pending(owner_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.connector_oauth_pending TO jarvis_app_runtime;

ALTER TABLE app.connector_oauth_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.connector_oauth_pending FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connector_oauth_pending_select ON app.connector_oauth_pending;
DROP POLICY IF EXISTS connector_oauth_pending_insert ON app.connector_oauth_pending;
DROP POLICY IF EXISTS connector_oauth_pending_update ON app.connector_oauth_pending;
DROP POLICY IF EXISTS connector_oauth_pending_delete ON app.connector_oauth_pending;

CREATE POLICY connector_oauth_pending_select ON app.connector_oauth_pending
  FOR SELECT TO jarvis_app_runtime
  USING (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());

CREATE POLICY connector_oauth_pending_insert ON app.connector_oauth_pending
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());

CREATE POLICY connector_oauth_pending_update ON app.connector_oauth_pending
  FOR UPDATE TO jarvis_app_runtime
  USING (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id())
  WITH CHECK (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());

CREATE POLICY connector_oauth_pending_delete ON app.connector_oauth_pending
  FOR DELETE TO jarvis_app_runtime
  USING (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());
```

- [ ] **Step 2: Apply and verify**

Run: `pnpm db:migrate`
Expected: `0041_google_unified_connection` recorded; `select provider_id from app.connector_definitions where provider_id='google'` returns one row.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/sql/0041_google_unified_connection.sql
git commit -m "feat(connectors): migration 0041 — seed google provider + oauth pending table"
```

### Task 3: DB types for the new value + pending table

**Files:**

- Modify: `packages/db/src/types.ts` (enum ~line 145; new table interface near the connector tables ~line 256; register in `JarvisDatabase` ~line 460-499)

- [ ] **Step 1: Extend the enum and add the table interface**

```typescript
// Replace the existing ConnectorProviderType (was: "calendar" | "email")
export type ConnectorProviderType = "calendar" | "email" | "google";

// Add near ConnectorAccountsTable:
export interface ConnectorOauthPendingTable {
  id: string;
  owner_user_id: string;
  provider_id: string;
  state: string;
  encrypted_secret: JsonColumn;
  created_at: TimestampColumn;
}

// Add the type alias next to ConnectorAccount:
export type ConnectorOauthPending = Selectable<ConnectorOauthPendingTable>;
```

- [ ] **Step 2: Register the table in `JarvisDatabase`**

```typescript
// Inside the JarvisDatabase interface, beside the other connector tables:
  "app.connector_oauth_pending": ConnectorOauthPendingTable;
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no usages of the new value yet break).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): types for unified google provider + connector_oauth_pending"
```

### Task 4: `GoogleOAuthClient` — auth URL (TDD)

**Files:**

- Create: `packages/connectors/src/oauth.ts`
- Test: `tests/integration/connectors-google.test.ts` (unit-style; no DB needed for this task)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { GoogleOAuthClient, GOOGLE_LOOPBACK_REDIRECT, GOOGLE_SCOPES } from "@jarv1s/connectors";

describe("GoogleOAuthClient.buildAuthUrl", () => {
  it("builds a consent URL with offline access, forced consent, scopes and state", () => {
    const client = new GoogleOAuthClient();
    const url = new URL(
      client.buildAuthUrl({
        clientId: "cid.apps.googleusercontent.com",
        scopes: GOOGLE_SCOPES,
        redirectUri: GOOGLE_LOOPBACK_REDIRECT,
        state: "state-123"
      })
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe(GOOGLE_LOOPBACK_REDIRECT);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_SCOPES.join(" "));
  });
});
```

- [ ] **Step 2: Run it (fails — module missing)**

Run: `vitest run tests/integration/connectors-google.test.ts -t "buildAuthUrl"`
Expected: FAIL (cannot find `@jarv1s/connectors` export `GoogleOAuthClient`).

- [ ] **Step 3: Implement auth URL + constants**

```typescript
// packages/connectors/src/oauth.ts
export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_LOOPBACK_REDIRECT = "http://localhost:1";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar"
] as const;

export interface GoogleConnectionSecret extends Record<string, unknown> {
  readonly kind: "google-oauth";
  readonly clientId: string;
  readonly clientSecret: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenExpiry: string; // ISO
  readonly grantedScopes: string[];
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

export interface GoogleOAuthClientDeps {
  readonly fetchFn?: typeof fetch;
  readonly now?: () => Date;
}

export class GoogleOAuthClient {
  private readonly fetchFn: typeof fetch;

  constructor(deps: GoogleOAuthClientDeps = {}) {
    this.fetchFn = deps.fetchFn ?? globalThis.fetch;
  }

  buildAuthUrl(input: {
    clientId: string;
    scopes: readonly string[];
    redirectUri: string;
    state: string;
  }): string {
    const url = new URL(GOOGLE_AUTH_ENDPOINT);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", input.state);
    url.searchParams.set("scope", input.scopes.join(" "));
    return url.toString();
  }
}
```

Then add to `packages/connectors/src/index.ts`:

```typescript
export * from "./oauth.js";
```

- [ ] **Step 4: Run it (passes)**

Run: `vitest run tests/integration/connectors-google.test.ts -t "buildAuthUrl"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/oauth.ts packages/connectors/src/index.ts tests/integration/connectors-google.test.ts
git commit -m "feat(connectors): GoogleOAuthClient.buildAuthUrl + google oauth constants"
```

### Task 5: `parseRedirectUrl` + code exchange + refresh (TDD)

**Files:**

- Modify: `packages/connectors/src/oauth.ts`
- Test: `tests/integration/connectors-google.test.ts`

- [ ] **Step 1: Write failing tests (faked fetch, no network)**

```typescript
import { GoogleOAuthClient, parseRedirectUrl } from "@jarv1s/connectors";

function fakeFetch(captured: { body?: string }, payload: object): typeof fetch {
  return (async (_url: string, init?: { body?: BodyInit | null }) => {
    captured.body = String(init?.body ?? "");
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    } as Response;
  }) as unknown as typeof fetch;
}

describe("parseRedirectUrl", () => {
  it("extracts code and state from a pasted loopback URL", () => {
    const parsed = parseRedirectUrl("http://localhost:1/?state=s1&code=4/abc&scope=x");
    expect(parsed).toEqual({ code: "4/abc", state: "s1" });
  });
  it("throws on an error redirect", () => {
    expect(() => parseRedirectUrl("http://localhost:1/?error=access_denied")).toThrow(
      /access_denied/
    );
  });
});

describe("GoogleOAuthClient.exchangeCode", () => {
  it("POSTs the auth code and returns tokens", async () => {
    const captured: { body?: string } = {};
    const client = new GoogleOAuthClient({
      fetchFn: fakeFetch(captured, {
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
        token_type: "Bearer"
      })
    });
    const tokens = await client.exchangeCode({
      clientId: "cid",
      clientSecret: "secret",
      code: "4/abc",
      redirectUri: "http://localhost:1"
    });
    expect(tokens.refresh_token).toBe("rt");
    const params = new URLSearchParams(captured.body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("4/abc");
    expect(params.get("client_secret")).toBe("secret");
  });
});

describe("GoogleOAuthClient.refreshAccessToken", () => {
  it("POSTs the refresh token and returns a fresh access token", async () => {
    const captured: { body?: string } = {};
    const client = new GoogleOAuthClient({
      fetchFn: fakeFetch(captured, {
        access_token: "at2",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
        token_type: "Bearer"
      })
    });
    const tokens = await client.refreshAccessToken({
      clientId: "cid",
      clientSecret: "secret",
      refreshToken: "rt"
    });
    expect(tokens.access_token).toBe("at2");
    expect(new URLSearchParams(captured.body).get("grant_type")).toBe("refresh_token");
  });
});
```

- [ ] **Step 2: Run (fails — functions missing)**

Run: `vitest run tests/integration/connectors-google.test.ts`
Expected: FAIL (`parseRedirectUrl`/`exchangeCode`/`refreshAccessToken` undefined).

- [ ] **Step 3: Implement**

```typescript
// add to packages/connectors/src/oauth.ts

export function parseRedirectUrl(redirectUrl: string): { code: string; state: string } {
  let url: URL;
  try {
    url = new URL(redirectUrl.trim());
  } catch {
    throw new Error("Pasted redirect URL is not a valid URL");
  }
  const error = url.searchParams.get("error");
  if (error) {
    throw new Error(`Google returned an authorization error: ${error}`);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    throw new Error("Redirect URL is missing the code or state parameter");
  }
  return { code, state };
}

// inside GoogleOAuthClient:
  private async postToken(params: Record<string, string>): Promise<GoogleTokenResponse> {
    const response = await this.fetchFn(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString()
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Google token endpoint returned ${response.status}: ${detail}`);
    }
    return (await response.json()) as GoogleTokenResponse;
  }

  async exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<GoogleTokenResponse> {
    return this.postToken({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code"
    });
  }

  async refreshAccessToken(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<GoogleTokenResponse> {
    return this.postToken({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token"
    });
  }
```

- [ ] **Step 4: Run (passes)**

Run: `vitest run tests/integration/connectors-google.test.ts`
Expected: PASS (all oauth.ts tests).

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/oauth.ts tests/integration/connectors-google.test.ts
git commit -m "feat(connectors): google oauth code-exchange, refresh, redirect parsing"
```

### Task 6: Repository — pending + unified google account (TDD)

**Files:**

- Modify: `packages/connectors/src/repository.ts`
- Test: `tests/integration/connectors-google.test.ts` (DB-backed; uses the test harness)

- [ ] **Step 1: Write the failing DB test**

Add a DB-backed `describe` (mirror `connectors.test.ts` setup — `resetFoundationDatabase`, `DataContextRunner`, `JARVIS_CONNECTOR_SECRET_KEY`):

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { ConnectorsRepository, createConnectorSecretCipher } from "@jarv1s/connectors";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("Google connection repository", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: ConnectorsRepository;
  const userA = (): AccessContext => ({ actorUserId: ids.userA, requestId: "req:a" });

  beforeAll(async () => {
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new ConnectorsRepository();
  });
  afterAll(async () => {
    await appDb?.destroy();
  });

  it("stores and reads back pending auth, then upserts the active google account", async () => {
    const cipher = createConnectorSecretCipher();
    await dataContext.withDataContext(userA(), (db) =>
      repository.upsertGooglePending(db, {
        state: "state-xyz",
        encryptedSecret: cipher.encryptJson({ clientId: "cid", clientSecret: "sec" })
      })
    );
    const pending = await dataContext.withDataContext(userA(), (db) =>
      repository.getGooglePending(db)
    );
    expect(pending?.state).toBe("state-xyz");

    const account = await dataContext.withDataContext(userA(), (db) =>
      repository.upsertGoogleAccount(db, {
        scopes: ["https://www.googleapis.com/auth/calendar"],
        encryptedSecret: cipher.encryptJson({ kind: "google-oauth", accessToken: "at" })
      })
    );
    // NOTE: repository returns ConnectorAccountSafeRow (snake_case) — not the camelCase DTO.
    expect(account.provider_id).toBe("google");
    expect(account.status).toBe("active");

    await dataContext.withDataContext(userA(), (db) => repository.deleteGooglePending(db));
    const after = await dataContext.withDataContext(userA(), (db) =>
      repository.getGooglePending(db)
    );
    expect(after).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run (fails — methods missing)**

Run: `pnpm db:up && pnpm db:migrate && vitest run tests/integration/connectors-google.test.ts -t "Google connection repository"`
Expected: FAIL (`upsertGooglePending` undefined).

- [ ] **Step 3: Implement repository methods**

```typescript
// add to packages/connectors/src/repository.ts (ConnectorsRepository class)
import { randomUUID } from "node:crypto";
import { sql } from "kysely";

export const GOOGLE_PROVIDER_ID = "google";

export interface GooglePendingRow {
  readonly id: string;
  readonly state: string;
  readonly encryptedSecret: EncryptedConnectorSecret;
}

// methods:
  async upsertGooglePending(
    scopedDb: DataContextDb,
    input: { state: string; encryptedSecret: EncryptedConnectorSecret }
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db.deleteFrom("app.connector_oauth_pending")
      .where("provider_id", "=", GOOGLE_PROVIDER_ID)
      .where("owner_user_id", "=", sql<string>`app.current_actor_user_id()`)
      .execute();
    await scopedDb.db.insertInto("app.connector_oauth_pending").values({
      id: randomUUID(),
      owner_user_id: sql<string>`app.current_actor_user_id()`,
      provider_id: GOOGLE_PROVIDER_ID,
      state: input.state,
      encrypted_secret: input.encryptedSecret,
      created_at: new Date()
    }).execute();
  }

  async getGooglePending(scopedDb: DataContextDb): Promise<GooglePendingRow | undefined> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db.selectFrom("app.connector_oauth_pending")
      .select(["id", "state", "encrypted_secret as encryptedSecret"])
      .where("provider_id", "=", GOOGLE_PROVIDER_ID)
      .executeTakeFirst();
    return row as GooglePendingRow | undefined;
  }

  async deleteGooglePending(scopedDb: DataContextDb): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db.deleteFrom("app.connector_oauth_pending")
      .where("provider_id", "=", GOOGLE_PROVIDER_ID).execute();
  }

  async upsertGoogleAccount(
    scopedDb: DataContextDb,
    input: { scopes: readonly string[]; encryptedSecret: EncryptedConnectorSecret }
  ): Promise<ConnectorAccountSafeRow> {
    assertDataContextDb(scopedDb);
    const existing = await scopedDb.db.selectFrom("app.connector_accounts")
      .select("id").where("provider_id", "=", GOOGLE_PROVIDER_ID).executeTakeFirst();
    if (existing) {
      return (await this.updateAccount(scopedDb, existing.id, {
        scopes: [...input.scopes], status: "active", encryptedSecret: input.encryptedSecret
      }))!;
    }
    return this.createAccount(scopedDb, {
      providerId: GOOGLE_PROVIDER_ID,
      scopes: [...input.scopes],
      status: "active",
      encryptedSecret: input.encryptedSecret
    });
  }

  // Repository owns ALL raw DataContextDb access (service must never cast scopedDb.db).
  async getActiveGoogleAccountSecret(
    scopedDb: DataContextDb
  ): Promise<{ id: string; encryptedSecret: EncryptedConnectorSecret } | undefined> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.connector_accounts")
      .select(["id", "encrypted_secret as encryptedSecret"])
      .where("provider_id", "=", GOOGLE_PROVIDER_ID)
      .where("status", "=", "active")
      .executeTakeFirst();
    return row as { id: string; encryptedSecret: EncryptedConnectorSecret } | undefined;
  }
```

(Note: `updateAccount` currently resets `revoked_at: null` and accepts `status` — reuse as-is. `getActiveGoogleAccountSecret` is the repository home for the secret read that the service used to do via a raw cast — see Task 7 fix B.)

- [ ] **Step 4: Run (passes)**

Run: `vitest run tests/integration/connectors-google.test.ts -t "Google connection repository"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/repository.ts tests/integration/connectors-google.test.ts
git commit -m "feat(connectors): repository methods for google pending auth + unified account"
```

### Task 7: `GoogleConnectionService` (TDD)

**Files:**

- Create: `packages/connectors/src/google-connection.ts`
- Modify: `packages/connectors/src/index.ts` (add `export * from "./google-connection.js";`)
- Test: `tests/integration/connectors-google.test.ts`

- [ ] **Step 1: Write failing test (faked oauth client)**

```typescript
import {
  ConnectorsRepository,
  GoogleConnectionService,
  GoogleOAuthClient,
  createConnectorSecretCipher
} from "@jarv1s/connectors";

it("startAuthorization stores pending creds and returns an auth url", async () => {
  const service = new GoogleConnectionService({
    repository: new ConnectorsRepository(),
    cipher: createConnectorSecretCipher(),
    oauthClient: new GoogleOAuthClient(),
    generateState: () => "fixed-state"
  });
  const result = await dataContext.withDataContext(userA(), (db) =>
    service.startAuthorization(db, { clientId: "cid", clientSecret: "sec" })
  );
  expect(result.authUrl).toContain("state=fixed-state");
  const pending = await dataContext.withDataContext(userA(), (db) =>
    new ConnectorsRepository().getGooglePending(db)
  );
  expect(pending?.state).toBe("fixed-state");
});

it("completeAuthorization validates state, exchanges code, and stores tokens", async () => {
  const oauthClient = new GoogleOAuthClient({
    fetchFn: (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
        token_type: "Bearer"
      }),
      text: async () => ""
    })) as unknown as typeof fetch
  });
  const service = new GoogleConnectionService({
    repository: new ConnectorsRepository(),
    cipher: createConnectorSecretCipher(),
    oauthClient,
    generateState: () => "fixed-state"
  });
  await dataContext.withDataContext(userA(), (db) =>
    service.startAuthorization(db, { clientId: "cid", clientSecret: "sec" })
  );
  const account = await dataContext.withDataContext(userA(), (db) =>
    service.completeAuthorization(db, {
      redirectUrl: "http://localhost:1/?code=4/abc&state=fixed-state"
    })
  );
  // ConnectorAccountSafeRow (snake_case) — service returns the safe row, not the DTO.
  expect(account.provider_id).toBe("google");
  expect(account.status).toBe("active");
});

it("completeAuthorization rejects a mismatched state", async () => {
  const service = new GoogleConnectionService({
    repository: new ConnectorsRepository(),
    cipher: createConnectorSecretCipher(),
    oauthClient: new GoogleOAuthClient(),
    generateState: () => "fixed-state"
  });
  await dataContext.withDataContext(userA(), (db) =>
    service.startAuthorization(db, { clientId: "cid", clientSecret: "sec" })
  );
  await expect(
    dataContext.withDataContext(userA(), (db) =>
      service.completeAuthorization(db, {
        redirectUrl: "http://localhost:1/?code=4/abc&state=WRONG"
      })
    )
  ).rejects.toThrow(/state/i);
});
```

- [ ] **Step 2: Run (fails)**

Run: `vitest run tests/integration/connectors-google.test.ts -t "Authorization"`
Expected: FAIL (`GoogleConnectionService` missing).

- [ ] **Step 3: Implement the service**

```typescript
// packages/connectors/src/google-connection.ts
import { randomUUID } from "node:crypto";
import type { DataContextDb } from "@jarv1s/db";
import type { ConnectorSecretCipher } from "./crypto.js";
import {
  GOOGLE_LOOPBACK_REDIRECT,
  GOOGLE_SCOPES,
  GoogleOAuthClient,
  parseRedirectUrl,
  type GoogleConnectionSecret
} from "./oauth.js";
import { ConnectorsRepository, type ConnectorAccountSafeRow } from "./repository.js";

/** User-correctable connect failures. Routes map this to HTTP 400 by TYPE (never by message text). */
export class GoogleConnectError extends Error {
  readonly statusCode = 400;
}

export interface GoogleConnectionServiceDeps {
  readonly repository: ConnectorsRepository;
  readonly cipher: ConnectorSecretCipher;
  readonly oauthClient: GoogleOAuthClient;
  readonly generateState?: () => string;
  readonly now?: () => Date;
}

export class GoogleConnectionService {
  private readonly generateState: () => string;
  private readonly now: () => Date;

  constructor(private readonly deps: GoogleConnectionServiceDeps) {
    this.generateState = deps.generateState ?? (() => randomUUID());
    this.now = deps.now ?? (() => new Date());
  }

  async startAuthorization(
    scopedDb: DataContextDb,
    input: { clientId: string; clientSecret: string }
  ): Promise<{ authUrl: string }> {
    const state = this.generateState();
    await this.deps.repository.upsertGooglePending(scopedDb, {
      state,
      encryptedSecret: this.deps.cipher.encryptJson({
        clientId: input.clientId,
        clientSecret: input.clientSecret
      })
    });
    const authUrl = this.deps.oauthClient.buildAuthUrl({
      clientId: input.clientId,
      scopes: GOOGLE_SCOPES,
      redirectUri: GOOGLE_LOOPBACK_REDIRECT,
      state
    });
    return { authUrl };
  }

  async completeAuthorization(
    scopedDb: DataContextDb,
    input: { redirectUrl: string }
  ): Promise<ConnectorAccountSafeRow> {
    const { code, state } = parseRedirectUrl(input.redirectUrl);
    const pending = await this.deps.repository.getGooglePending(scopedDb);
    if (!pending) {
      throw new GoogleConnectError(
        "No pending Google authorization found — start the connect flow again"
      );
    }
    if (pending.state !== state) {
      throw new GoogleConnectError(
        "Authorization state did not match — please retry the connect flow"
      );
    }
    const creds = this.deps.cipher.decryptJson(pending.encryptedSecret) as {
      clientId: string;
      clientSecret: string;
    };
    const tokens = await this.deps.oauthClient.exchangeCode({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      code,
      redirectUri: GOOGLE_LOOPBACK_REDIRECT
    });
    if (!tokens.refresh_token) {
      throw new GoogleConnectError(
        "Google did not return a refresh token — re-consent with prompt=consent"
      );
    }
    const expiry = new Date(this.now().getTime() + tokens.expires_in * 1000).toISOString();
    const bundle: GoogleConnectionSecret = {
      kind: "google-oauth",
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: expiry,
      grantedScopes: tokens.scope ? tokens.scope.split(" ") : [...GOOGLE_SCOPES]
    };
    const account = await this.deps.repository.upsertGoogleAccount(scopedDb, {
      scopes: bundle.grantedScopes,
      encryptedSecret: this.deps.cipher.encryptJson(bundle)
    });
    await this.deps.repository.deleteGooglePending(scopedDb);
    return account;
  }

  /** Returns a non-expired access token, refreshing if needed. Persists a refreshed token.
   *  Fix B: the secret read lives in the repository (getActiveGoogleAccountSecret) — the service
   *  never touches raw Kysely or casts scopedDb.db. */
  async getFreshAccessToken(scopedDb: DataContextDb): Promise<string> {
    const stored = await this.deps.repository.getActiveGoogleAccountSecret(scopedDb);
    if (!stored) {
      throw new GoogleConnectError("No active Google connection");
    }
    const bundle = this.deps.cipher.decryptJson(stored.encryptedSecret) as GoogleConnectionSecret;
    if (new Date(bundle.tokenExpiry).getTime() - this.now().getTime() > 60_000) {
      return bundle.accessToken;
    }
    const refreshed = await this.deps.oauthClient.refreshAccessToken({
      clientId: bundle.clientId,
      clientSecret: bundle.clientSecret,
      refreshToken: bundle.refreshToken
    });
    const nextExpiry = new Date(this.now().getTime() + refreshed.expires_in * 1000).toISOString();
    await this.deps.repository.upsertGoogleAccount(scopedDb, {
      scopes: bundle.grantedScopes,
      encryptedSecret: this.deps.cipher.encryptJson({
        ...bundle,
        accessToken: refreshed.access_token,
        tokenExpiry: nextExpiry
      })
    });
    return refreshed.access_token;
  }
}
```

(Add `assertDataContextDb` guards via the repository calls; the direct read for `getFreshAccessToken` reuses the already-scoped transaction.)

- [ ] **Step 4: Run (passes)**

Run: `vitest run tests/integration/connectors-google.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/google-connection.ts packages/connectors/src/index.ts tests/integration/connectors-google.test.ts
git commit -m "feat(connectors): GoogleConnectionService — authorize/complete/refresh"
```

### Task 8: Shared HTTP contracts

**Files:**

- Modify: `packages/shared/src/connectors-api.ts`

- [ ] **Step 1: Add request/response types + schemas** (mirror the existing `createConnectorAccount*` shapes)

```typescript
export interface GoogleAuthorizeRequest {
  clientId: string;
  clientSecret: string;
}
export interface GoogleAuthorizeResponse {
  authUrl: string;
}
export interface GoogleCompleteRequest {
  redirectUrl: string;
}
export interface GoogleCompleteResponse {
  account: ConnectorAccountDto;
}

export const googleAuthorizeRequestSchema = {
  type: "object",
  required: ["clientId", "clientSecret"],
  additionalProperties: false,
  properties: {
    clientId: { type: "string", minLength: 1 },
    clientSecret: { type: "string", minLength: 1 }
  }
} as const;

export const googleAuthorizeResponseSchema = {
  type: "object",
  required: ["authUrl"],
  properties: { authUrl: { type: "string" } }
} as const;

export const googleCompleteRequestSchema = {
  type: "object",
  required: ["redirectUrl"],
  additionalProperties: false,
  properties: { redirectUrl: { type: "string", minLength: 1 } }
} as const;

export const googleAuthorizeRouteSchema = {
  body: googleAuthorizeRequestSchema,
  response: { 200: googleAuthorizeResponseSchema }
} as const;

export const googleCompleteRouteSchema = {
  body: googleCompleteRequestSchema,
  response: { 201: createConnectorAccountResponseSchema } // { account: ConnectorAccountDto }
} as const;
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add packages/shared/src/connectors-api.ts
git commit -m "feat(shared): google connect authorize/complete contracts"
```

### Task 9: REST endpoints (TDD via server.inject)

**Files:**

- Modify: `packages/connectors/src/routes.ts`
- Test: `tests/integration/connectors-google.test.ts` (server-backed describe)

- [ ] **Step 1: Failing route test** — inject `/authorize` then `/complete` with an injected oauth client.

The connectors routes accept an optional `repository`/`secretCipher`; extend `ConnectorsRoutesDependencies` with an optional `googleService?: GoogleConnectionService` so tests inject a faked-fetch service. Test:

```typescript
import { createApiServer } from "../../apps/api/src/server.js"; // see note below
// ... build server with an injected googleService whose oauthClient uses a fake fetch ...
const authorize = await server.inject({
  method: "POST",
  url: "/api/connectors/google/authorize",
  headers: { authorization: `Bearer ${ids.sessionA}` },
  payload: { clientId: "cid", clientSecret: "sec" }
});
expect(authorize.statusCode).toBe(200);
expect(authorize.json<{ authUrl: string }>().authUrl).toContain("accounts.google.com");

const complete = await server.inject({
  method: "POST",
  url: "/api/connectors/google/complete",
  headers: { authorization: `Bearer ${ids.sessionA}` },
  payload: { redirectUrl: `http://localhost:1/?code=4/abc&state=...` }
});
expect(complete.statusCode).toBe(201);
expect(complete.json<{ account: { providerId: string } }>().account.providerId).toBe("google");
```

**Note:** if `createApiServer` does not expose dependency injection for the google service, inject it through the same composition path the other connector deps use (`apps/api/src/server.ts:58-66` → `registerBuiltInApiRoutes`). For the test, prefer driving the **service** directly (Task 7 covers logic) and assert the routes only wire/serialize — i.e. construct the server with a test-only `googleService` override if available, else assert the two handlers exist and return 401 without a session and 400 on a malformed body (which need no Google call).

- [ ] **Step 2: Run (fails — routes missing)**

Run: `vitest run tests/integration/connectors-google.test.ts -t "google connect routes"`
Expected: FAIL (404 on the new URLs).

- [ ] **Step 3: Implement the handlers**

```typescript
// packages/connectors/src/routes.ts — extend deps + add handlers
import { GoogleConnectionService } from "./google-connection.js";
import { GoogleOAuthClient } from "./oauth.js";
import { googleAuthorizeRouteSchema, googleCompleteRouteSchema } from "@jarv1s/shared";

// in ConnectorsRoutesDependencies:
  readonly googleService?: GoogleConnectionService;

// in registerConnectorsRoutes, after existing setup:
  const googleService =
    dependencies.googleService ??
    new GoogleConnectionService({ repository, cipher: secretCipher, oauthClient: new GoogleOAuthClient() });

  server.post("/api/connectors/google/authorize", { schema: googleAuthorizeRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const body = request.body as { clientId?: unknown; clientSecret?: unknown };
      const clientId = requiredString(body.clientId, "clientId");
      const clientSecret = requiredString(body.clientSecret, "clientSecret");
      const result = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        googleService.startAuthorization(scopedDb, { clientId, clientSecret })
      );
      return result; // { authUrl }
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.post("/api/connectors/google/complete", { schema: googleCompleteRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const redirectUrl = requiredString((request.body as { redirectUrl?: unknown }).redirectUrl, "redirectUrl");
      const account = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        googleService.completeAuthorization(scopedDb, { redirectUrl })
      );
      return reply.code(201).send({ account: serializeAccount(account) });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });
```

Map `GoogleConnectError` to **400 by type** (not by message text). Import it from `./google-connection.js` and add the first branch of `handleRouteError`:

```typescript
import { GoogleConnectError } from "./google-connection.js";

// at the top of handleRouteError(error, reply):
if (error instanceof GoogleConnectError) {
  return reply.code(error.statusCode).send({ error: error.message });
}
```

A wording change to a service error message must never silently flip a 400 to a 500 — the mapping keys on the error **type**.

- [ ] **Step 4: Run (passes)**

Run: `vitest run tests/integration/connectors-google.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/routes.ts tests/integration/connectors-google.test.ts
git commit -m "feat(connectors): /api/connectors/google authorize + complete endpoints"
```

### Task 10: Full-suite gate for Phase 1

- [ ] **Step 1: Run the connectors suite + foundation gate**

Run: `pnpm test:connectors && pnpm verify:foundation`
Expected: all pass (new migrations 0040/0041 included; the foundation migration-count assertion, if present, updated — see note).

- [ ] **Step 2: If a migration-count/list assertion fails**, update it to include `0040` and `0041` (search tests for `schema_migrations` / migration-list assertions, e.g. `tests/integration/foundation.test.ts`). Commit that fix with **explicit paths** (never `git add -A` — the working tree is shared with other sessions).

```bash
git add tests/integration/foundation.test.ts
git commit -m "test: include migrations 0040/0041 in foundation assertions"
```

### Task 11: Live round-trip verification harness (issue #12)

**Files:**

- Create: `scripts/verify-google-connection.ts`

This is the **manual proof** (not run in CI; retained as a spike). It reads the connected user's google connection, gets a fresh access token, lists today's calendar events (read), then creates and deletes a throwaway event (reversible write).

- [ ] **Step 1: Write the harness**

```typescript
/* Usage: tsx scripts/verify-google-connection.ts <userId>
   Requires JARVIS_CONNECTOR_SECRET_KEY and a DB with an active google connection. */
import { DataContextRunner, createDatabase } from "@jarv1s/db";
import {
  ConnectorsRepository,
  GoogleConnectionService,
  GoogleOAuthClient,
  createConnectorSecretCipher
} from "@jarv1s/connectors";
import { getJarvisDatabaseUrls } from "@jarv1s/db";

async function main() {
  const userId = process.argv[2];
  if (!userId) throw new Error("pass a userId");
  const appDb = createDatabase({
    connectionString: getJarvisDatabaseUrls().app,
    maxConnections: 1
  });
  const dc = new DataContextRunner(appDb);
  const service = new GoogleConnectionService({
    repository: new ConnectorsRepository(),
    cipher: createConnectorSecretCipher(),
    oauthClient: new GoogleOAuthClient()
  });
  const accessToken = await dc.withDataContext({ actorUserId: userId, requestId: "verify" }, (db) =>
    service.getFreshAccessToken(db)
  );
  const auth = { authorization: `Bearer ${accessToken}` };

  // READ: list today's primary-calendar events
  const list = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=5&singleEvents=true&orderBy=startTime&timeMin=" +
      encodeURIComponent(new Date().toISOString()),
    { headers: auth }
  );
  console.log("READ events status:", list.status, (await list.json()).items?.length ?? 0, "events");

  // WRITE (reversible): create then delete a temp event
  const created = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      summary: "Jarv1s connection test (safe to ignore)",
      start: { dateTime: new Date(Date.now() + 86_400_000).toISOString() },
      end: { dateTime: new Date(Date.now() + 90_000_000).toISOString() }
    })
  });
  const event = await created.json();
  console.log("WRITE create status:", created.status, "id:", event.id);
  const del = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event.id}`,
    {
      method: "DELETE",
      headers: auth
    }
  );
  console.log("WRITE delete status:", del.status);
  await appDb.destroy();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Connect Ben's account (manual)** via the Settings UI (Phase 2) or by driving `/authorize` → consent → `/complete` with `curl`, then run:

Run: `tsx scripts/verify-google-connection.ts <ben-user-id>`
Expected: READ prints a 200 + event count; WRITE create prints 200 + an id; delete prints 204. **Also note the time** — re-run after ~8 days to settle the testing-mode refresh-token question (open Q1).

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-google-connection.ts
git commit -m "chore(connectors): live google connection verification harness (issue #12)"
```

---

## Phase 2 — Settings "Connect Google" UI

### Task 12: Web API client functions

**Files:**

- Modify: `apps/web/src/api/client.ts`

- [ ] **Step 1: Add the two calls** (mirror `createConnectorAccount`)

```typescript
import type {
  GoogleAuthorizeRequest,
  GoogleAuthorizeResponse,
  GoogleCompleteRequest,
  GoogleCompleteResponse
} from "@jarv1s/shared";

export async function authorizeGoogleConnection(
  input: GoogleAuthorizeRequest
): Promise<GoogleAuthorizeResponse> {
  return requestJson<GoogleAuthorizeResponse>("/api/connectors/google/authorize", {
    method: "POST",
    body: input
  });
}
export async function completeGoogleConnection(
  input: GoogleCompleteRequest
): Promise<GoogleCompleteResponse> {
  return requestJson<GoogleCompleteResponse>("/api/connectors/google/complete", {
    method: "POST",
    body: input
  });
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck`

```bash
git add apps/web/src/api/client.ts
git commit -m "feat(web): google connect api client calls"
```

### Task 13: Connect Google panel

**Files:**

- Create: `apps/web/src/connectors/connect-google-panel.tsx`
- Modify: `apps/web/src/settings/settings-page.tsx` (render `<ConnectGooglePanel/>`)

- [ ] **Step 1: Build the panel** (two-step: paste client JSON → open consent → paste redirect URL). Reuse `.panel`, `.primary-button`, `.form-error`, React Query invalidation of `queryKeys.connectors.accounts`.

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Cable } from "lucide-react";
import { authorizeGoogleConnection, completeGoogleConnection } from "../api/client";
import { queryKeys } from "../api/query-keys";

export function ConnectGooglePanel(): JSX.Element {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const authorize = useMutation({
    mutationFn: () =>
      authorizeGoogleConnection({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
    onSuccess: (r) => {
      setAuthUrl(r.authUrl);
      setError(null);
    },
    onError: (e: Error) => setError(e.message)
  });
  const complete = useMutation({
    mutationFn: () => completeGoogleConnection({ redirectUrl: redirectUrl.trim() }),
    onSuccess: async () => {
      setAuthUrl(null);
      setRedirectUrl("");
      setClientId("");
      setClientSecret("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.connectors.accounts });
    },
    onError: (e: Error) => setError(e.message)
  });

  return (
    <section className="panel" aria-labelledby="connect-google-title">
      <div className="panel-heading">
        <Cable size={20} aria-hidden="true" />
        <h2 id="connect-google-title">Connect Google</h2>
      </div>
      <ol className="connect-steps">
        <li>
          Create a Google Cloud project, enable the Gmail &amp; Calendar APIs, and create an OAuth
          client of type <strong>Desktop app</strong>. Add yourself as a test user.
        </li>
        <li>Paste your client ID &amp; secret below and start authorization.</li>
        <li>
          Approve in the browser. It will fail to load <code>http://localhost:1</code> — that is
          expected. Copy the full address-bar URL and paste it back.
        </li>
      </ol>
      <label>
        Client ID
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
      </label>
      <label>
        Client secret
        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </label>
      <button
        className="primary-button"
        disabled={authorize.isPending || !clientId || !clientSecret}
        onClick={() => authorize.mutate()}
      >
        {authorize.isPending ? <LoaderCircle className="spin" size={18} /> : null} Start
        authorization
      </button>
      {authUrl ? (
        <>
          <p>
            <a href={authUrl} target="_blank" rel="noreferrer">
              Open Google consent ↗
            </a>
          </p>
          <label>
            Pasted redirect URL
            <input
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              placeholder="http://localhost:1/?code=..."
            />
          </label>
          <button
            className="primary-button"
            disabled={complete.isPending || !redirectUrl}
            onClick={() => complete.mutate()}
          >
            {complete.isPending ? <LoaderCircle className="spin" size={18} /> : null} Finish
            connecting
          </button>
        </>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
```

Render it in `settings-page.tsx` alongside the existing `ConnectorsPanel` (import + `<ConnectGooglePanel />` in the panel grid).

- [ ] **Step 2: Web typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/connectors/connect-google-panel.tsx apps/web/src/settings/settings-page.tsx
git commit -m "feat(web): Connect Google settings panel"
```

### Task 14: e2e (mocked REST)

**Files:**

- Modify: `tests/e2e/mock-api.ts` (handle the two routes)
- Create: `tests/e2e/connect-google.spec.ts`

- [ ] **Step 1: Add mock handlers** for `/api/connectors/google/authorize` (return `{ authUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test" }`) and `/complete` (push a google account to `state.connectorAccounts`, return `201 { account }`).

- [ ] **Step 2: Write the spec**

```typescript
import { test, expect } from "@playwright/test";
import { mockApi } from "./mock-api";

test("connects Google via the settings flow", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: [],
    notifications: [],
    tasks: []
  });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Connect Google" })).toBeVisible();
  await page.getByLabel("Client ID").fill("cid.apps.googleusercontent.com");
  await page.getByLabel("Client secret").fill("secret");
  await page.getByRole("button", { name: "Start authorization" }).click();
  await expect(page.getByRole("link", { name: /Open Google consent/ })).toBeVisible();
  await page.getByLabel("Pasted redirect URL").fill("http://localhost:1/?code=4/abc&state=test");
  await page.getByRole("button", { name: "Finish connecting" }).click();
  await expect(page.getByText("Google")).toBeVisible();
});
```

- [ ] **Step 3: Run + commit**

Run: `pnpm test:e2e -- connect-google`
Expected: PASS.

```bash
git add tests/e2e/mock-api.ts tests/e2e/connect-google.spec.ts
git commit -m "test(e2e): connect google settings flow"
```

---

## Phase 3 — Guided skill (Jarvis assistant-tool)

### Task 15: `connectors.startGoogleGuidance` read tool (TDD)

**Files:**

- Modify: `packages/connectors/src/manifest.ts` (add `assistantTools`)
- Test: `tests/integration/connectors-google.test.ts` (gateway invocation) or the existing connectors manifest test

- [ ] **Step 1: Failing test** — invoke the tool through the gateway (mirror the tasks/calendar tool tests) and assert it returns step text + a deep-link to `/settings`, marked `risk: "read"`, runs without confirmation, and **returns no secrets**.

- [ ] **Step 2: Declare the tool** (per the module-sdk `ModuleAssistantToolManifest` contract)

```typescript
// in connectorsModuleManifest:
assistantTools: [
  {
    name: "connectors.startGoogleGuidance",
    description:
      "Explain, step by step, how the user connects their Google account (Gmail + Calendar). Read-only guidance; the user finishes the secret steps in Settings.",
    permissionId: "connectors.view",
    risk: "read",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        steps: { type: "array", items: { type: "string" } },
        settingsUrl: { type: "string" }
      }
    },
    execute: async () => ({
      data: {
        steps: [
          "In Google Cloud Console, create a project and enable the Gmail API and Google Calendar API.",
          "Configure the OAuth consent screen and add yourself as a test user.",
          "Create an OAuth client of type 'Desktop app' and copy the client ID and secret.",
          "Open Jarv1s Settings → Connect Google, paste the client ID and secret, and start authorization.",
          "Approve in the browser; the http://localhost:1 page will fail to load (expected). Copy the full address-bar URL and paste it back in Settings to finish."
        ],
        settingsUrl: "/settings"
      }
    })
  }
];
```

(Confirm the exact `ToolResult` shape — `{ data }` vs `{ content }` — against `packages/module-sdk/src/index.ts` and an existing tool like `tasks.listVisible` before implementing.)

- [ ] **Step 3: Run + commit**

Run: `vitest run tests/integration/connectors-google.test.ts -t "guidance"`
Expected: PASS.

```bash
git add packages/connectors/src/manifest.ts tests/integration/connectors-google.test.ts
git commit -m "feat(connectors): connectors.startGoogleGuidance assistant tool"
```

### Task 16: Persona hint (optional, small)

**Files:**

- Modify: `packages/chat/src/live/runtime.ts` (`DEFAULT_JARVIS_PERSONA`)

- [ ] **Step 1: Add one line** so Jarvis proactively offers help and uses the tool, without leaking that secrets go in Settings:

```typescript
// append to DEFAULT_JARVIS_PERSONA lines:
"If the user wants to connect Google (Gmail/Calendar), call connectors.startGoogleGuidance and walk them through it; the secret-entry steps happen in Settings, not in chat.";
```

- [ ] **Step 2: Run chat suite + commit**

Run: `pnpm test:chat`
Expected: PASS (persona is a string; assert any persona snapshot test is updated).

```bash
git add packages/chat/src/live/runtime.ts
git commit -m "feat(chat): persona offers google-connect guidance via the connectors tool"
```

---

## Final gate

- [ ] **Run the full gate**

Run: `pnpm verify:foundation && pnpm audit:release-hardening`
Expected: both green (lint, format, file-size, typecheck, migrate, integration; release-hardening `passed: true`).

- [ ] **Confirm no secret leakage** — grep the diff for any path that serializes `encrypted_secret`, `clientSecret`, `accessToken`, or `refreshToken` to a response/log/payload. The only serializer is `serializeAccount` (returns `hasSecret` boolean, never the secret).

---

## Self-review (run against the spec)

- **Spec §5 scopes** → Tasks 2 (default_scopes), 4 (GOOGLE_SCOPES). ✓
- **Spec §6 unified connection** → Tasks 1–3, 6 (`upsertGoogleAccount`). ✓
- **Spec §7 OAuth flow (loopback-copy-paste)** → Tasks 4–9 (auth URL, exchange, `parseRedirectUrl`, pending+state CSRF, endpoints). ✓
- **Spec §8 guided skill, secret hand-off** → Tasks 13 (Settings takes secrets), 15–16 (Jarvis guides, no secrets in chat). ✓
- **Spec §10 security** → encrypted bundle (Tasks 6–7), state CSRF (Task 7), owner-only RLS (Tasks 2–3), no-leak check (Final gate). ✓
- **Spec §11 verification** → Task 11 (live round-trip = issue #12) + integration tests throughout; ~7-day token re-check noted. ✓
- **Spec §9 (sync/grounding)** → explicitly OUT of scope; no tasks (correct). ✓
- **Placeholder scan:** every code step shows real code; no "TBD"/"add error handling". The two "confirm the exact shape against X" notes (Task 9 server DI, Task 15 ToolResult) are _verification instructions_, not missing code — acceptable because they pin an exact file to check.
- **Type consistency (redone after Coordinator fix A):** the **casing boundary** is now explicit — `ConnectorsRepository`/`GoogleConnectionService` return **`ConnectorAccountSafeRow` (snake_case:** `provider_id`, `status`, `has_secret`); the **HTTP layer** serializes to **`ConnectorAccountDto` (camelCase:** `providerId`, `hasSecret`) via `serializeAccount`. Audited every access: Task 6/7 repo+service assertions use `account.provider_id` (snake); Task 9 asserts on the **serialized response** `account.providerId` (camel — correct, that's the DTO); Task 14 e2e reads rendered text. Names (`GoogleConnectionSecret`, `GoogleTokenResponse`, `GoogleConnectError`, `upsertGoogleAccount`, `getGooglePending`, `getActiveGoogleAccountSecret`, `startAuthorization`/`completeAuthorization`/`getFreshAccessToken`, `authorizeGoogleConnection`/`completeGoogleConnection`) are consistent across tasks.
- **Layering (Coordinator fix B):** the service holds no raw Kysely; the secret read is `repository.getActiveGoogleAccountSecret` (Task 6). No `scopedDb.db` cast anywhere in the service.

## Coordinator review — verdict & resolutions

Verdict **REVISE→build** (`/tmp/m-b1-coordinator-review.md`); points 1–3 APPROVED (keep the enum split, the pending table, `localhost:1`). Required items, now applied to this plan:

- **(A) casing** — repo/service returns are `ConnectorAccountSafeRow` snake_case; Task 6/7 assertions fixed to `account.provider_id`; Task 9 keeps `.providerId` on the serialized DTO. Self-review redone.
- **(B) layering** — added `repository.getActiveGoogleAccountSecret`; `getFreshAccessToken` no longer casts `scopedDb.db`.
- **(C-doc) provider_type conflation** — recorded in ADR 0006 + spec §9 (see below).
- **(rec) typed errors** — `GoogleConnectError` mapped to 400 by type; no message-substring matching.
- **(rec) staging** — explicit `git add` paths only; no `git add -A`.

Cleared to build Phase 1 with **no re-review**. Ping Coordinator when Phase 1's gate is green **and before any merge**.

## Merge / landing (Coordinator owns order)

- Before merging: **integrate `main` (now `cda9f23`, includes PR #37 + #38)** into this branch.
- **Expect conflicts** in `apps/web/src/settings/settings-page.tsx` (Task 13) and `packages/chat/src/live/runtime.ts` (Task 16) with the Chat Phase 3 / M-A5 Plan 3 streams — resolve on integration.
- Clear landing order with the Coordinator; do not merge to `main` unilaterally.

## Open items carried from the spec (not blockers)

1. ~7-day testing-mode refresh-token expiry — measured in Task 11.
2. Downstream sync/grounding (inline vs cache) — next slice.
3. **`provider_type` now mixes domain + vendor** (see ADR 0006) — the sync slice must discover connections by domain (scopes / a service map), not `WHERE provider_type='calendar'`, and reconcile the legacy `google-calendar`/`google-email` rows.
