# packages/db — Thermo-Nuclear Code Quality Audit

**Reviewer:** Automated subagent  
**Date:** 2026-06-10  
**Scope:** `packages/db/src/` — all files  
**Adjacent files read:** `packages/auth/src/index.ts`, `packages/settings/src/repository.ts`,
`packages/settings/src/routes.ts`, `packages/connectors/src/routes.ts`,
`scripts/rewrap-secrets.ts`, `infra/postgres/migrations/0001_app_schema.sql`,
`infra/postgres/migrations/0002_app_rls.sql`, `infra/postgres/migrations/0004_auth_workspaces_settings.sql`,
`infra/postgres/migrations/0005_admin_audit_events.sql`, `infra/postgres/migrations/0017_shares.sql`,
`infra/postgres/migrations/0028_workspace_teardown.sql`, `infra/postgres/migrations/0045_auth_secret_rls.sql`,
`infra/postgres/migrations/0046_auth_sessions_rls.sql`, `infra/postgres/bootstrap/0000_roles.sql`

---

## Executive Summary

`packages/db` is lean and well-structured. The `DataContextDb` branded type, the `assertDataContextDb`
runtime guard, and the two-parameter `setLocal` helper form a tight, correct RLS enforcement layer.
Migration hash-checking is correctly implemented. No BYPASSRLS is granted to runtime roles.

The findings below are genuine defects or risks — none are phantom or theoretical. Severities range
from HIGH (three issues) to INFO (four informational notes).

---

## Findings

### [HIGH] `unsafeSelectVisibleProbeIdsForTest` is a method on a production-exported class

- **File:** `packages/db/src/data-context.ts:41`
- **Category:** Architecture, Security
- **Finding:** `DataContextRunner.unsafeSelectVisibleProbeIdsForTest()` bypasses `withDataContext`
  entirely — it issues a raw query against `rootDb` with no actor GUC set. The method name signals
  test intent, but `DataContextRunner` is the live class exported from `@jarv1s/db` and instantiated
  in every environment including production. Any caller (including misconfigured production code)
  can invoke this method and receive all visible probe items without RLS enforcement. There is no
  compile-time or package boundary that restricts it to tests.
- **Evidence:**
  ```ts
  async unsafeSelectVisibleProbeIdsForTest(): Promise<string[]> {
    const rows = await this.rootDb
      .selectFrom("app.rls_probe_items")
      .select("id")
      .orderBy("id")
      .execute();
    return rows.map((row) => row.id);
  }
  ```
- **Impact:** Low direct risk (the probe table contains synthetic test data, not user PII), but it
  establishes a pattern of raw root-DB reads on the production class. A future analogous "escape
  hatch" on a real user-data class would be a hard-invariant violation. It also pollutes the public
  API surface of a core library.
- **Recommendation:** Move this method out of `DataContextRunner` into a test-only helper file
  (e.g., `tests/integration/db-test-helpers.ts`) that constructs the raw query independently. If
  the method must stay in the package, put it in a separate `@jarv1s/db/testing` export path (not
  the default `.` export) and clearly document the non-production status. Never export test helpers
  from the default barrel.

---

### [LOW] `resolveKeyring` fails fast with an uncaught `SyntaxError` if `keysEnvVar` contains malformed JSON — no operator-friendly message

- **File:** `packages/db/src/keyring.ts:45`
- **Category:** Error Handling
- **Finding:** The call to `JSON.parse(keysJson)` inside `resolveKeyring` has no try/catch. If the
  env var (e.g. `JARVIS_CONNECTOR_SECRET_KEYS`) contains malformed JSON, `JSON.parse` throws a
  `SyntaxError` with no context about which env var caused the failure. This manifests as a
  cryptic startup crash rather than a meaningful configuration error.
- **Evidence:**
  ```ts
  const parsed = JSON.parse(keysJson) as Record<string, string>;
  for (const [id, secret] of Object.entries(parsed)) {
    const buf = createHash("sha256").update(secret).digest();
    keys.set(id, buf);
    ...
  }
  ```
  There is no validation that `parsed` is a non-array object, that each value is a string, or
  that keys are non-empty. Passing `'["v1"]'` (JSON array) or `'{"v1":null}'` would silently
  produce a key derived from the string `"null"`.
- **Impact:** Operator key-rotation mistakes produce an uninformative crash. More seriously, if a
  value is not a string (e.g., an accidental `null`), `createHash(...).update(secret)` where
  `secret` is `null` would crash after the miscast — or in some JS runtimes coerce `null` to the
  string `"null"`, producing a key that does not match any rotation expectation.
- **Recommendation:**
  ```ts
  let parsed: unknown;
  try {
    parsed = JSON.parse(keysJson);
  } catch {
    throw new Error(`${keysEnvVar} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${keysEnvVar} must be a JSON object {"id":"secret",...}`);
  }
  for (const [id, secret] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof secret !== "string" || !secret) {
      throw new Error(`${keysEnvVar}: value for key "${id}" must be a non-empty string`);
    }
    ...
  }
  ```

---

### [HIGH] `runSqlFiles` has no advisory lock, no transaction, and no idempotency guard

- **File:** `packages/db/src/migrations/sql-runner.ts:98-116`
- **Category:** Architecture, Error Handling
- **Finding:** `runSqlMigrations` acquires an advisory lock (`jarv1s:migrations`) and wraps each
  migration in a transaction. `runSqlFiles` does neither. It executes SQL files sequentially with
  no lock, no transaction, and no tracking of which files have been applied. If two migrate
  processes run concurrently (e.g., two deploy replicas starting simultaneously), both will
  execute the same bootstrap/grant files. Grants are typically idempotent, but CREATE statements
  or role mutations in bootstrap files may not be. A partial failure mid-file leaves the database
  in an unknown state with no rollback and no record of what was applied.
- **Evidence:**
  ```ts
  export async function runSqlFiles(connectionString: string, directory: string): Promise<string[]> {
    const client = new Client({ connectionString });
    const files = await readdir(directory);
    const sqlFiles = files.filter((file) => file.endsWith(".sql")).sort();
    ...
    for (const fileName of sqlFiles) {
      const sql = await readFile(join(directory, fileName), "utf8");
      await client.query(sql);  // raw, no transaction, no lock
      executed.push(fileName);
    }
  }
  ```
- **Impact:** Bootstrap and grants SQL could run twice or partially. For `infra/postgres/bootstrap`
  (which uses `IF NOT EXISTS` guards throughout), this is currently safe. For
  `infra/postgres/grants` (which uses `GRANT ... TO`), a partial run is non-fatal but leaves
  role privileges in an inconsistent state. A future bootstrap file without idempotency guards
  would break silently under concurrent deployment.
- **Recommendation:** Either (a) apply the same advisory lock used by `runSqlMigrations` so
  concurrent deploys serialize, or (b) document clearly that callers are responsible for ensuring
  single execution (and enforce this with a deploy-process lock at a higher level). At minimum,
  add a comment warning that `runSqlFiles` is not concurrency-safe.

---

### [MEDIUM] Non-null assertion on keyring key lookup in `encryptJson`

- **File:** `packages/connectors/src/crypto.ts:18`, `packages/ai/src/crypto.ts:18`
  (both live outside `packages/db` but depend on `keyring.ts`)
- **Category:** TypeScript
- **Finding:** Both `ConnectorSecretCipher.encryptJson` and `AiSecretCipher.encryptJson` use a
  non-null assertion `!` when reading the current key:
  ```ts
  const key = this.keyring.keys.get(this.keyring.currentKeyId)!;
  ```
  The `!` asserts the key is always present, but `resolveKeyring` only guarantees this at
  construction time. If a `Keyring` is constructed by any means other than `resolveKeyring`
  (e.g., in a test that hand-builds the struct), the assertion could produce `undefined` passed
  as a `Buffer` to `createCipheriv`, which would crash at AES encryption time with a confusing
  error rather than a clear "key id not found in keyring" message.
- **Impact:** Crash during encryption of user credentials. The assertion hides a recoverable
  condition (key not in map) behind an opaque runtime error.
- **Recommendation:**
  ```ts
  const key = this.keyring.keys.get(this.keyring.currentKeyId);
  if (!key) throw new Error(`Current key id "${this.keyring.currentKeyId}" not found in keyring`);
  ```

---

### [MEDIUM] `SettingsRepository` accepts and uses raw `Kysely<JarvisDatabase>` — intentional but undocumented

- **File:** `packages/settings/src/repository.ts:16, 64`
- **Category:** Architecture
- **Finding:** `SettingsRepository` accepts a raw `Kysely<JarvisDatabase>` (not `DataContextDb`)
  and has its own private `type SettingsDb = Kysely<JarvisDatabase> | Transaction<JarvisDatabase>`.
  It runs `transaction().execute(...)` directly without going through `withDataContext`, which means
  no actor GUC is set. This is the only repository in the codebase that deliberately bypasses the
  `DataContextDb` pattern.
  
  The design is technically defensible: admin tables (`workspaces`, `workspace_memberships`,
  `resource_grants`, `instance_settings`, `admin_audit_events`) have no RLS at the database level,
  and access is gated at the route layer by `requireAdmin`. However:
  - This is a pattern exception with no comment explaining why DataContextDb is not used.
  - Any developer adding a method to `SettingsRepository` that touches an RLS-protected table
    (e.g., reading `app.tasks` in an admin context) would unknowingly bypass RLS.
  - The `SettingsDb` union type is an internal type alias that re-invents what `DataContextDb`
    already provides.
- **Impact:** If a future admin feature touches user-data tables through `SettingsRepository`, RLS
  is silently bypassed. The absence of documentation makes this an invisible exception.
- **Recommendation:** Add a comment block on `SettingsRepository` (or its constructor) explaining:
  "Admin tables do not have RLS; this repository runs without `withDataContext` by design. Do not
  add methods that query user-data (RLS-protected) tables." Consider a lint rule or doc convention
  to flag this.

---

### [MEDIUM] `bootstrapFirstJarvisUser` in `packages/auth` manually sets actor GUC outside `withDataContext`

- **File:** `packages/auth/src/index.ts:237-306`
- **Category:** Architecture
- **Finding:** The first-user bootstrap function opens a raw `appDb.transaction()` and manually
  calls `set_config('app.actor_user_id', user.id, true)` instead of routing through
  `DataContextRunner.withDataContext`. It also inserts into `app.workspaces` and
  `app.workspace_memberships` (tables with no RLS) and `app.admin_audit_events` from within this
  raw transaction — all outside the canonical data-context pattern.
  
  The GUC `set_config('app.actor_user_id', ${user.id}, true)` is correct (transaction-scoped,
  parameterized), but this is duplicating the exact logic that `setLocal` in `data-context.ts`
  already encapsulates. There is no `requestId` GUC set, so `app.request_id` is unset during
  this bootstrap, inconsistent with what `withDataContext` would set.
- **Evidence:** `packages/auth/src/index.ts:252`
  ```ts
  await sql`SELECT set_config('app.actor_user_id', ${user.id}, true)`.execute(transaction);
  ```
- **Impact:** Pattern divergence: any future developer maintaining this code may not know to set
  the GUC. The missing `app.request_id` GUC means audit-trail queries that join on request_id
  will find NULL for first-user bootstraps. Low operational risk but meaningful drift from the
  canonical pattern.
- **Recommendation:** Expose `DataContextRunner` to the auth package (it already accepts `appDb`)
  and replace the manual transaction + GUC with `dataContext.withDataContext(accessContext, ...)`.
  If `DataContextRunner` is not available in auth context, extract the GUC setup into a shared
  internal helper that `setLocal` and this code both call.

---

### [LOW] `AccessContext.requestId` is optional but callers that need it throw a 500 at route layer

- **File:** `packages/db/src/data-context.ts:9`, `packages/settings/src/routes.ts:356-362`
- **Category:** TypeScript, Error Handling
- **Finding:** `AccessContext.requestId` is typed as `readonly requestId?: string`. In
  `withDataContext`, a missing requestId is silently replaced with `randomUUID()`. However, in
  `packages/settings/src/routes.ts`, a separate `requireRequestId(accessContext)` function throws
  HTTP 500 if `requestId` is absent — a different strategy. Because `AuthSessionResolver` always
  supplies `requestId` (it defaults to `randomUUID()`), this path can never actually throw in
  practice, but the dual handling creates confusion: callers of `withDataContext` get a
  generated ID, while admin route callers throw.
- **Evidence:** `packages/settings/src/routes.ts:356-362`
  ```ts
  function requireRequestId(accessContext: AccessContext): string {
    if (!accessContext.requestId) {
      throw new HttpError(500, "Request id is missing");
    }
    return accessContext.requestId;
  }
  ```
- **Impact:** Conceptual inconsistency. The optional field implies absence is acceptable, but
  some callers treat it as required. This leads to fragile code paths and a dead error branch.
- **Recommendation:** Make `requestId` non-optional in `AccessContext` (it is always set by every
  code path that produces an `AccessContext`). Remove `requireRequestId` and use
  `accessContext.requestId` directly. This would be a small breaking change but eliminates the
  confusion and the dead error branch.

---

### [LOW] `createDatabase` pool lacks `idleTimeoutMillis`, exposing potential connection exhaustion

- **File:** `packages/db/src/database.ts:17-25`
- **Category:** Architecture, Error Handling
- **Finding:** The `pg.Pool` created by `createDatabase` sets `max` (default 4) and
  `connectionTimeoutMillis` (default 5000ms) but does not set `idleTimeoutMillis`. Without an
  idle timeout, idle connections in the pool are held indefinitely until the database server
  terminates them (e.g., due to `idle_in_transaction_session_timeout` or a TCP keepalive timeout).
  In tests, multiple pools are created per suite without always being destroyed, which can exhaust
  the Postgres `max_connections` during a long test run.
- **Evidence:** `packages/db/src/database.ts:17-25` — no `idleTimeoutMillis` in pool config.
  `tests/integration/briefings.test.ts:532-568` — `scopedWorkerDb` is created inside a helper
  function and only destroyed in `finally`. If `workerBoss.offWork` throws before `destroy()`,
  the pool leaks (though the `finally` mitigates most cases).
- **Impact:** In production with stable load, not a problem. Under test runs with many concurrent
  suites, or if a Postgres restart terminates idle connections the pool does not know about, new
  queries may stall until `connectionTimeoutMillis` expires.
- **Recommendation:** Add `idleTimeoutMillis: 30000` (or make it configurable via
  `DatabaseOptions`) to `pg.Pool` construction. This is standard practice for long-lived Node
  servers.

---

### [INFO] `current_workspace_id()` GUC function granted to app_runtime but never set by any app code

- **File:** `infra/postgres/migrations/0002_app_rls.sql:22-41`,
  `infra/postgres/migrations/0028_workspace_teardown.sql:241-243`
- **Category:** Architecture (dead code)
- **Finding:** Migration 0002 creates `app.current_workspace_id()` and grants `EXECUTE` to
  `jarvis_app_runtime` and `jarvis_worker_runtime`. Migration 0028 drops the function. The current
  `data-context.ts` never sets `app.workspace_id` (workspace was removed in Slice 1f). The grant
  in 0002 and the drop in 0028 are both applied correctly so there is no net residue. However, the
  sequence is only understandable by reading both migrations. A developer reading 0002 in isolation
  would believe `app.workspace_id` GUC is still active.
- **Impact:** No runtime impact. Code-reading confusion only.
- **Recommendation:** The migrations are applied and cannot be changed (hash-checked). A comment
  in `CLAUDE.md` or the architecture notes explaining that `current_workspace_id` was created in
  0002 and dropped in 0028 would close the gap for future readers. This is already partially
  captured in memory (coordinator notes).

---

### [INFO] `AuthSessionResolver` uses raw `Kysely<JarvisDatabase>` — security model correct but pattern exception undocumented

- **File:** `packages/db/src/auth-session.ts:9`
- **Category:** Architecture
- **Finding:** `AuthSessionResolver.resolveAccessContext()` receives a `Kysely<JarvisDatabase>`
  (not `DataContextDb`) and calls a `SECURITY DEFINER` function `app.resolve_auth_session()`. The
  security model is sound: the call executes as `jarvis_app_runtime` and the SECURITY DEFINER
  function is owned by `jarvis_auth_runtime` (migration 0046), so `app_runtime` never holds direct
  `SELECT` on `auth_sessions`. However, there is no comment on the class explaining why raw Kysely
  is acceptable here and under what conditions it can safely bypass `DataContextDb`.
- **Impact:** Pattern exception that could confuse a maintainer into thinking raw Kysely is
  acceptable for resolving user data. Low risk given the SECURITY DEFINER isolation.
- **Recommendation:** Add a comment on `AuthSessionResolver` or its constructor: "Pre-context use:
  this class is called before an AccessContext exists, to establish one. Uses raw Kysely
  intentionally; isolation is enforced by the SECURITY DEFINER function in migration 0046."

---

### [INFO] `SharesRepository.listForResource` allows a grantee to enumerate all shares on a resource

- **File:** `packages/db/src/sharing/shares-repository.ts:51-65`
- **Category:** Security (information disclosure, low severity)
- **Finding:** `listForResource(scopedDb, resourceType, resourceId)` returns all shares for a
  resource, gated only by the RLS policy which allows reads to the owner OR any grantee. A user
  who holds a `view` share on a resource can call `listForResource` and see all other grantees
  (their user IDs and grant levels). This is a minor information-disclosure: a read-only grantee
  learns who else has access and at what level.
- **Impact:** Low: grantee user IDs and levels are not secrets, and the feature was presumably
  designed to support showing share lists in a UI. However, there is no upper-bound on share count
  returned (no `limit`), so a resource with thousands of shares would return them all.
- **Recommendation:** If grantees should not see other grantees, filter the query by
  `owner_user_id = actorUserId`. If they should see, add a `limit` to prevent unbounded result
  sets. Confirm the intended sharing UX before making this change.

---

## Summary Table

| Severity | Count | Issues |
|---|---|---|
| HIGH | 3 | `unsafeSelectVisibleProbeIdsForTest` on production class; `resolveKeyring` JSON parse crash; `runSqlFiles` no lock/transaction |
| MEDIUM | 3 | Non-null assertion in cipher; `SettingsRepository` bypasses DataContextDb (undocumented); `bootstrapFirstJarvisUser` manual GUC |
| LOW | 2 | Optional `requestId` dual handling; missing `idleTimeoutMillis` |
| INFO | 4 | Dead `current_workspace_id` GUC history; `AuthSessionResolver` raw Kysely undocumented; share enumeration by grantee; `request_id: null` in bootstrap audit events |

## What Is Correct and Should Not Change

- **DataContextDb branding:** The `unique symbol` brand, `assertDataContextDb` runtime guard, and
  the `DataContextRunner.withDataContext` transaction + GUC setup are correctly implemented.
  Repositories in `packages/db/src/` all call `assertDataContextDb` at entry. This is the right
  pattern.
- **Migration hash-check:** SHA-256 checksum on read, compared against stored checksum before
  executing, with an advisory lock preventing concurrent migration runs. Correct.
- **Identifier quoting in migration runner:** `quoteIdentifier` validates with
  `/^[a-zA-Z_][a-zA-Z0-9_]*$/` before interpolating into SQL. Correct.
- **NOBYPASSRLS on all runtime roles:** Bootstrap confirms `jarvis_app_runtime`,
  `jarvis_worker_runtime`, `jarvis_auth_runtime`, and `jarvis_migration_owner` all have
  `NOBYPASSRLS`. Correct.
- **Set-config parameterization:** `setLocal` uses Kysely's `sql` template tag with parameters,
  preventing any SQL injection through actor IDs. Correct.
- **No connection leaks in known code paths:** Most test suites call `destroy()` in `afterAll`.
  The `rewrap-secrets.ts` script calls `db.destroy()` in its normal path. The one noted risk
  (briefings test helper) is mitigated by `finally`.
- **Keyring production guard:** `resolveKeyring` throws if key env var is absent in production.
  Correct.
- **RLS coverage:** All user-data tables have `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL
  SECURITY` + per-role policies. Admin-only tables (`workspaces`, `workspace_memberships`,
  `resource_grants`, `instance_settings`, `admin_audit_events`) intentionally have no RLS because
  they are accessed only through admin-gated routes. This design is acceptable provided the route
  gate is maintained.
