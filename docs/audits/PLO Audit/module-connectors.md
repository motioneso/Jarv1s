# Connectors Module — Thermo-Nuclear Audit
**Date:** 2026-06-10
**Reviewer:** PLO Audit agent (claude-sonnet-4-6)
**Scope:** `packages/connectors/src/`, `packages/connectors/sql/`
**Files reviewed:**
- `src/crypto.ts`
- `src/google-connection.ts`
- `src/index.ts`
- `src/manifest.ts`
- `src/oauth.ts`
- `src/repository.ts`
- `src/routes.ts`
- `sql/0009_connectors_module.sql`
- `sql/0010_connector_admin_safe_metadata.sql`
- `sql/0022_connectors_owner_only.sql`
- `sql/0043_connector_google_enum.sql`
- `sql/0044_google_unified_connection.sql`
- `tests/integration/connectors.test.ts`
- `tests/integration/connectors-google.test.ts`

---

## Findings

---

### [LOW] Admin RLS policies bound to `jarvis_migration_owner`, not `jarvis_app_runtime` — dead-code hygiene, not a runtime security gap

- **File:** `packages/connectors/sql/0010_connector_admin_safe_metadata.sql:4–28`
- **Category:** Security / Architecture
- **Finding:** The two admin-level RLS policies added in migration 0010 are scoped to `jarvis_migration_owner`:
  ```sql
  CREATE POLICY connector_definitions_admin_metadata_select
  ON app.connector_definitions
  FOR SELECT
  TO jarvis_migration_owner     -- ← wrong role for runtime queries
  USING ( ... admin_user.is_instance_admin ... );

  CREATE POLICY connector_accounts_admin_metadata_select
  ON app.connector_accounts
  FOR SELECT
  TO jarvis_migration_owner     -- ← wrong role for runtime queries
  USING ( ... admin_user.is_instance_admin ... );
  ```
  At runtime the app connects as `jarvis_app_runtime`. These policies are dead letters for any runtime actor, including admins. The `connector_definitions` table still works for normal users because there is a live `jarvis_app_runtime` policy on it (from 0009). The `connector_accounts` admin policy has no effect at all.
- **Impact:** The admin policies are misleading: they create the visual impression that admins can SELECT connector_accounts directly, but at runtime under `jarvis_app_runtime` only the owner-scoped policy applies. The actual admin read path works today only because it goes through the `SECURITY DEFINER` function `list_connector_account_safe_metadata()`, which runs as the function owner (a superuser-capable role) and so bypasses the dead policy entirely. The danger is a future author who trusts the RLS policy as documentation and builds a direct `SELECT` query on behalf of an admin — it will silently return empty results rather than failing visibly.
- **Recommendation:** Either change `TO jarvis_migration_owner` to `TO jarvis_app_runtime` on both policies (since the predicate checks `is_instance_admin` anyway), or explicitly drop these policies and add a comment stating that admin reads are exclusively through the SECURITY DEFINER function. Do not leave misleading dead policies in place.

---

### [HIGH] `/api/connectors/google/authorize` has no rate limit

- **File:** `packages/connectors/src/routes.ts:60–77`
- **Category:** Security
- **Finding:** The `POST /api/connectors/google/authorize` endpoint accepts a `clientId` and `clientSecret`, writes an encrypted pending row to `connector_oauth_pending`, and returns a Google auth URL. It has no `config: { rateLimit: ... }` block. Only `/api/connectors/google/complete` (lines 81–100) has the `JARVIS_RL_OAUTH_MAX` guard.
- **Impact:** An authenticated user can call `/authorize` at full speed to:
  1. Exhaust server-side `connector_oauth_pending` write capacity (each call does a DELETE + INSERT under the same user+provider lock, but the DB round-trips are unbounded).
  2. Use the endpoint as a test oracle: probe whether a given Google `clientId` is syntactically accepted without any cost gating.
  3. Overwrite a victim user's legitimately in-flight pending row if a CSRF or session-fixation vector existed. (The victim's own account is protected by RLS, but the write path has no volume guard.)
- **Recommendation:** Apply the same `JARVIS_RL_OAUTH_MAX` rate limit to `/authorize` as is already applied to `/complete`. The rate-limit test at `tests/integration/api-rate-limit.test.ts` covers only `/complete`; add a symmetric test for `/authorize`.

---

### [MEDIUM] `connector_oauth_pending` rows have no expiry or TTL

- **File:** `packages/connectors/sql/0044_google_unified_connection.sql:31–69`, `packages/connectors/src/repository.ts:162–205`
- **Category:** Security
- **Finding:** `connector_oauth_pending` is a short-lived table for the period between `/authorize` and `/complete`. The table has a `created_at` column but no `CHECK` constraint, DB-level partial index, or pg-boss scheduled job to expire stale rows. If a user starts the flow but never completes it (browser crash, abandonment, or a deliberately half-executed flow), the partial credentials (encrypted `clientId` + `clientSecret`) remain in the DB indefinitely. The `upsertGooglePending` call does a prior `DELETE` before each new `INSERT`, so at most one pending row per user+provider exists — but that row never self-expires.
- **Impact:** Low-severity persistent storage of encrypted OAuth client credentials that the user may have already revoked or rotated. The encryption is sound, but the data should not accumulate. If the key is ever compromised, re-decrypting all accumulated pending rows is worse than if they had expired.
- **Recommendation:** Add a `CHECK (created_at > now() - interval '10 minutes')` constraint on `connector_oauth_pending`, or a periodic pg-boss cleanup job that purges rows older than a configurable TTL. An application-layer check in `getGooglePending` that rejects stale rows and calls `deleteGooglePending` is the minimal fix without a migration.

---

### [LOW] `GoogleTokenResponse` error body from Google reaches the server LOG via Fastify's default error handler

- **File:** `packages/connectors/src/oauth.ts:109–114`, `packages/connectors/src/routes.ts:392–418`
- **Category:** Security / Error Handling
- **Finding:** When the Google token endpoint returns a non-OK response, `postToken` throws:
  ```ts
  throw new Error(`Google token endpoint returned ${response.status}: ${detail}`);
  ```
  where `detail` is the raw response body from Google. This is a plain `Error`, not a `GoogleConnectError`. In `handleRouteError` (routes.ts:392–418), `GoogleConnectError` is caught and serialized cleanly. Plain `Error` instances are checked for a small list of known messages (lines 400–414). The string `"Google token endpoint returned ..."` does not match any of those checks. The `throw error` fallback on line 418 re-throws the raw error to Fastify.

  Fastify's default error handler serializes unhandled `Error` objects as:
  ```json
  { "statusCode": 500, "error": "Internal Server Error", "message": "<error.message>" }
  ```
  meaning the full Google error body — which can contain OAuth error codes, `error_description` strings, and occasionally hint tokens — reaches the server LOG, NOT the HTTP response body.
- **Impact:** Google OAuth error responses can contain structured information (`error_description`, `error_uri`, partially masked credential references) that the caller should not see. Even without token material, leaking Google error text breaks the principle of minimal information disclosure and violates the "secrets never escape" invariant if Google ever echoes back a credential fragment in an error body.
- **Recommendation:** Wrap the `postToken` error in `completeAuthorization` (google-connection.ts line 81 area) and `getFreshAccessToken` (line 120 area) with a `GoogleConnectError` that maps to a sanitized message:
  ```ts
  try {
    tokens = await this.deps.oauthClient.exchangeCode(...);
  } catch (err) {
    throw new GoogleConnectError("Google token exchange failed — check your client credentials");
  }
  ```
  Log the original error server-side for debugging; never forward the raw text to the caller.

---

### [MEDIUM] `requireAdmin` queries `app.users` directly on the root `Kysely<JarvisDatabase>` instance, bypassing the DataContextDb invariant

- **File:** `packages/connectors/src/routes.ts:253–272`
- **Category:** Architecture
- **Finding:** The hard invariant states "Repositories accept only a branded `DataContextDb` handle, never a root Kysely instance." The `requireAdmin` function receives `dependencies.appDb` (a raw `Kysely<JarvisDatabase>`) and queries `app.users` directly:
  ```ts
  const user = await dependencies.appDb
    .selectFrom("app.users")
    .select(["id", "is_instance_admin"])
    .where("id", "=", accessContext.actorUserId)
    .executeTakeFirst();
  ```
  This bypasses RLS entirely: the query runs as whatever pool role the `appDb` connection uses, not the per-request actor context. The query is likely `jarvis_app_runtime` or higher, but no `SET LOCAL jarvis.current_actor_user_id` has been established for that connection.
- **Impact:** The admin check is architecturally unsound. Because this is a read-only `SELECT` on a specific user ID that equals `accessContext.actorUserId` (which was just resolved from a valid session), the practical security risk is low — the query cannot return another user's row. However:
  1. It creates a precedent for bypassing `withDataContext`.
  2. `app.users` has ENABLE ROW LEVEL SECURITY (migration 0045). Depending on the runtime role's policies, the query may or may not respect RLS, making the outcome policy-dependent and fragile.
  3. If `appDb` is shared across requests, the connection may not have the right actor context set when pooled.
- **Recommendation:** Implement `requireAdmin` using the `dataContext.withDataContext` flow, passing the already-resolved `accessContext`. The admin check itself can be a helper that queries `app.users` through the scoped DB or, better, a module-SDK mechanism for checking instance-admin status.

---

### [MEDIUM] `getFreshAccessToken` is not atomic — concurrent refresh calls can race

- **File:** `packages/connectors/src/google-connection.ts:110–135`
- **Category:** Architecture / Security
- **Finding:** `getFreshAccessToken` reads the stored secret, checks expiry, calls Google to refresh, then writes the updated token bundle back. There is no locking or optimistic concurrency between the read and the write:
  ```ts
  const stored = await this.deps.repository.getActiveGoogleAccountSecret(scopedDb);
  // ... checks expiry ...
  const refreshed = await this.deps.oauthClient.refreshAccessToken(...);
  await this.deps.repository.upsertGoogleAccount(scopedDb, { ... refreshed token ... });
  return refreshed.access_token;
  ```
  If two requests both see an expired token and race, both will call Google's token endpoint with the same `refreshToken`. Google's default behavior is to invalidate the previous refresh token on the first successful use, making the second call fail with `invalid_grant`. The second call will throw an unhandled error from `postToken` (which becomes the leaking error described above).
- **Impact:** Concurrent sync operations or background jobs that both need a fresh Google token will produce a token invalidation error on the second caller. Depending on whether that error is surfaced gracefully, it may mark the connector account as errored and require the user to re-authorize. This is a reliability issue that worsens under load.
- **Recommendation:** Use a database-level advisory lock (e.g., `pg_advisory_xact_lock`) keyed on the connector account ID around the read-check-refresh-write cycle, or use a `SELECT ... FOR UPDATE` on the account row. Alternatively, limit token refreshes to a single background worker path.

---

### [MEDIUM] `creds` decryption result is unsafely cast without structural validation

- **File:** `packages/connectors/src/google-connection.ts:77–84`
- **Category:** TypeScript / Security
- **Finding:** After decrypting the pending secret, the result is cast to a known shape without runtime validation:
  ```ts
  const creds = this.deps.cipher.decryptJson(pending.encryptedSecret) as {
    clientId: string;
    clientSecret: string;
  };
  ```
  `decryptJson` returns `Record<string, unknown>`. If the stored blob is malformed (e.g., from a corrupted or tampered DB row), accessing `creds.clientId` and `creds.clientSecret` will silently return `undefined`, which then gets passed to `exchangeCode` and ultimately to Google as the literal string `"undefined"`. The resulting Google error will flow through the unhandled error path described in the previous finding.
- **Impact:** No direct security impact under normal operation. However, if a partial DB corruption or a key-rotation misconfiguration causes decryption to succeed but return incomplete data, the error message surfaces "undefined" as a credential string to Google's endpoint, which may log it on Google's side.
- **Recommendation:** Add a guard after decryption:
  ```ts
  const raw = this.deps.cipher.decryptJson(pending.encryptedSecret);
  if (typeof raw.clientId !== "string" || typeof raw.clientSecret !== "string") {
    throw new GoogleConnectError("Stored Google credentials are malformed — restart the flow");
  }
  ```
  Apply the same pattern for the `bundle` cast as `GoogleConnectionSecret` (line 115).

---

### [MEDIUM] `POST /api/connectors/accounts` accepts an arbitrary `tokenPayload` object with no schema enforcement at the application layer

- **File:** `packages/connectors/src/routes.ts:137–159`
- **Category:** Security / Quality
- **Finding:** The generic account creation endpoint encrypts whatever JSON object the caller sends as `tokenPayload` without any shape validation:
  ```ts
  const encryptedSecret = secretCipher.encryptJson(body.tokenPayload);
  ```
  `body.tokenPayload` is validated only to be a JSON object (not null, not array). Its keys and values are completely caller-controlled. This means:
  1. A user can encrypt and store arbitrary data of unbounded size (subject only to Postgres `jsonb` limits, ~1 GB).
  2. The endpoint provides a plausible-deniability encrypted storage oracle: any data can be written to the server as an "OAuth token payload" with no relationship to any actual connector credential.
  3. There is no `provider_id`-level validation that the payload matches the expected shape for that provider (e.g., Google expects `access_token`, `refresh_token`; Microsoft expects different fields).
- **Impact:** Moderate: encrypted storage of arbitrary user data under the connector table is an unintended capability. At scale it can also be an encrypted data exfiltration channel.
- **Recommendation:** Either restrict the generic account endpoint to a declared schema per `provider_id`, or limit the maximum `tokenPayload` size at the route schema level (e.g., add a JSON Schema `maxProperties` / `maxLength` constraint on the Fastify route schema).

---

### [LOW] `connector_accounts` has no UNIQUE constraint on `(owner_user_id, provider_id)`

- **File:** `packages/connectors/sql/0009_connectors_module.sql:42–56`
- **Category:** Architecture / Quality
- **Finding:** `connector_oauth_pending` has `UNIQUE (owner_user_id, provider_id)` (migration 0044), but `connector_accounts` does not. The `upsertGoogleAccount` method in the repository handles the "existing Google account" case by doing a SELECT + conditional INSERT/UPDATE, but the generic `createAccount` path (`POST /api/connectors/accounts`) does not check for duplicates and will happily create a second row for the same `(owner_user_id, provider_id)` pair.
- **Impact:** A user calling `POST /api/connectors/accounts` twice with `providerId: "google"` will get two active `google` connector rows. `getActiveGoogleAccountSecret` uses `executeTakeFirst` and so will silently return whichever row Postgres returns first (by index scan order). The second row is unreachable through the refresh path and wastes storage.
- **Recommendation:** Add a `UNIQUE (owner_user_id, provider_id)` constraint to `connector_accounts` in a new migration, or add an `ON CONFLICT (owner_user_id, provider_id) DO UPDATE` clause to `createAccount`. Decide first whether the design intent is multi-account per provider (which the current design does not fully support) or single-account.

---

### [LOW] `handleRouteError` matches error messages by string literal — fragile and incomplete

- **File:** `packages/connectors/src/routes.ts:400–417`
- **Category:** Code Quality / Error Handling
- **Finding:** The fallback error branch in `handleRouteError` checks `error.message` using equality and substring matching:
  ```ts
  if (error.message === "Session is missing or expired") { ... }
  if (error.message === "Invalid bearer token") { ... }
  if (error.message === "Workspace context is unavailable") { ... }
  if (error.message.includes("foreign key") || error.message.includes("violates row-level security policy")) { ... }
  ```
  This is a string-matching anti-pattern for error classification. These checks are duplicated across other modules. If the originating error message changes spelling or locale, the check silently fails and the error re-throws as a 500.
- **Impact:** Brittle: any rename of these error strings in auth/db packages will silently cause 500 responses for conditions that should be 401/403/400. The `"Workspace context is unavailable"` check is particularly suspicious given that `workspaceId` was permanently removed from `AccessContext` in Slice 1f — this branch may be dead code.
- **Recommendation:** Introduce typed error classes (e.g., `AuthError`, `ForbiddenError`) in `@jarv1s/db` or `@jarv1s/auth` and use `instanceof` checks consistently. Remove the `"Workspace context is unavailable"` branch if it is confirmed dead after the workspaceId removal.

---

### [LOW] `oauth.ts`: `GoogleTokenResponse` is cast without runtime validation

- **File:** `packages/connectors/src/oauth.ts:113`
- **Category:** TypeScript
- **Finding:**
  ```ts
  return (await response.json()) as GoogleTokenResponse;
  ```
  This is a bare type assertion on an external API response. If Google changes its response shape (adds deprecation wrappers, changes field names), the code will silently receive malformed data and downstream callers (e.g., the `refresh_token` check on google-connection.ts:87) will fail at the point of use rather than at the boundary.
- **Impact:** Low in practice (Google API contract is stable), but violates the principle of validate-at-the-boundary. Missing `access_token` or `expires_in` will cause cryptic downstream errors rather than a clear parse failure.
- **Recommendation:** Add a narrow runtime guard at the parse boundary:
  ```ts
  const raw = await response.json();
  if (typeof raw.access_token !== "string" || typeof raw.expires_in !== "number") {
    throw new Error("Unexpected Google token response shape");
  }
  return raw as GoogleTokenResponse;
  ```

---

### [LOW] Admin connector route not listed in manifest `routes` array

- **File:** `packages/connectors/src/manifest.ts:88–127`
- **Category:** Architecture
- **Finding:** The manifest `routes` array lists all user-facing and admin-facing routes. The admin route `GET /api/admin/connectors/accounts` is listed (line 121–126). However, the two Google-specific OAuth routes (`POST /api/connectors/google/authorize` and `POST /api/connectors/google/complete`) are absent from the manifest `routes` array even though they are registered by `registerConnectorsRoutes`.
- **Impact:** The manifest `routes` array is used by the module SDK for documentation, permission enforcement documentation, and potentially auto-generated API schema validation. Omitting the OAuth routes means they are invisible to any tooling that relies on the manifest for route enumeration. Depending on how the permission gate is enforced (at route registration vs. at manifest introspection), this could also mean the OAuth routes are not subject to manifest-level permission checks.
- **Recommendation:** Add `POST /api/connectors/google/authorize` (permissionId: `connectors.manage`) and `POST /api/connectors/google/complete` (permissionId: `connectors.manage`) to the manifest `routes` array. Verify that any manifest-level permission middleware uses the registered route list.

---

### [LOW] `revokeAccount` overwrites the encrypted secret with `{ revoked: true }` but does not clear the old tokens from memory before writing

- **File:** `packages/connectors/src/routes.ts:195`
- **Category:** Security
- **Finding:** On revocation, the route encrypts `{ revoked: true }` and writes it, correctly overwriting the real token material in the database:
  ```ts
  const encryptedSecret = secretCipher.encryptJson({ revoked: true });
  ```
  This is correct. However, the Google integration does not call the external revocation endpoint (`https://oauth2.googleapis.com/revoke`) when a connector account is revoked. The local credential is wiped, but the Google-issued access token and refresh token remain valid until they expire or the user manually revokes them in Google's account settings.
- **Impact:** After a user revokes a Jarv1s connector account, their live Google OAuth tokens (which may have `gmail.modify` and `calendar` write access) remain active for up to 1 hour (access token TTL) and the refresh token is valid indefinitely. If the keyring were compromised or the old encrypted blob were available from a backup, the tokens could still be used.
- **Recommendation:** On revocation, call `https://oauth2.googleapis.com/revoke?token=<refresh_token>` before overwriting the local record. Decrypt the existing secret, POST the revocation, then overwrite. Handle the revocation call failure gracefully (log and continue — the local revocation should proceed even if Google's endpoint is unavailable, but log a warning).

---

### [LOW] `manifest.ts` migration list is stale relative to actual `sql/` directory

- **File:** `packages/connectors/src/manifest.ts:34–35`
- **Category:** Architecture / Quality
- **Finding:** The manifest's `database.migrations` array lists only two files:
  ```ts
  migrations: ["sql/0009_connectors_module.sql", "sql/0010_connector_admin_safe_metadata.sql"],
  ```
  But the actual `sql/` directory contains five migration files (0009, 0010, 0022, 0043, 0044). The `migrationDirectories` field points to the full directory, which the migration runner presumably uses. It is unclear whether `migrations` is authoritative or decorative. If any tooling uses `database.migrations` directly for execution, the three newer files will be skipped.
- **Impact:** If `database.migrations` is used by any migration runner path, the connector schema may be silently incomplete (missing the unified Google provider, the `connector_oauth_pending` table, and owner-only RLS fixes). Even if it is purely decorative, it is misleading documentation.
- **Recommendation:** Either update `database.migrations` to list all five SQL files in order, or remove the field and rely exclusively on `migrationDirectories`. Add a CI check that compares the `migrations` list to the actual directory contents.

---

### [INFO] `encryptJson` uses a non-null assertion on the current key lookup

- **File:** `packages/connectors/src/crypto.ts:18`
- **Category:** TypeScript
- **Finding:**
  ```ts
  const key = this.keyring.keys.get(this.keyring.currentKeyId)!;
  ```
  The `!` non-null assertion silences the compiler on a `Map.get()` result. If `resolveKeyring` produces a keyring where `keys.get(currentKeyId)` is undefined (e.g., a misconfiguration), this will produce `undefined` at runtime and the subsequent `createCipheriv` call will throw an opaque `TypeError` rather than a clear configuration error.
- **Impact:** Low — `resolveKeyring` is expected to guarantee the invariant. But the assertion hides a misconfiguration path.
- **Recommendation:** Replace with an explicit guard:
  ```ts
  const key = this.keyring.keys.get(this.keyring.currentKeyId);
  if (!key) throw new Error(`Keyring does not contain current key id: ${this.keyring.currentKeyId}`);
  ```

---

### [INFO] `safeAccountQuery` passes raw `DataContextDb["db"]` internally, not `DataContextDb`

- **File:** `packages/connectors/src/repository.ts:263`
- **Category:** Architecture
- **Finding:** The private helper `safeAccountQuery` accepts `DataContextDb["db"]` (a raw `Kysely` instance) rather than `DataContextDb`:
  ```ts
  private safeAccountQuery(db: DataContextDb["db"]) {
  ```
  It is called only from within the class itself after the `assertDataContextDb` guard has already run. However, this creates a hole where internal refactoring could accidentally wire an un-guarded `Kysely` instance to the query.
- **Impact:** No current security risk. The guard runs before any call to this helper. But it is an architectural inconsistency with the invariant.
- **Recommendation:** Accept `DataContextDb` and use `db.db` inside the helper, or document explicitly why the narrower type is acceptable here.

---

### [INFO] `connector_accounts` lacks a DELETE grant — no bulk delete path for the worker or admin

- **File:** `packages/connectors/sql/0009_connectors_module.sql:136`
- **Category:** Architecture
- **Finding:** The grant on `connector_accounts` is `SELECT, INSERT, UPDATE` — no DELETE:
  ```sql
  GRANT SELECT, INSERT, UPDATE ON app.connector_accounts TO jarvis_app_runtime;
  ```
  Revocation sets `status = 'revoked'` (a soft delete), which is correct. However, there is no operator or admin path to hard-delete a connector account (e.g., for GDPR data erasure, or if the user CASCADE doesn't fire). The `ON DELETE CASCADE` from `app.users` handles user deletion at the DB level, but the runtime role cannot DELETE rows.
- **Impact:** No current bug, since the design intentionally uses soft-delete. But the absence of a DELETE grant means there is no supported path for an operator to purge individual revoked accounts without a direct DB connection as the migration owner. Documenting this intent (or adding a SECURITY DEFINER function for admin purge) would make the design explicit.
- **Recommendation:** Add a comment in the migration (or a new migration) explicitly documenting the soft-delete-only intent and the operator purge path.

---

### [INFO] No test for `getFreshAccessToken` when the token is near-expiry (the refresh branch)

- **File:** `tests/integration/connectors-google.test.ts:269–301`
- **Category:** Tests
- **Finding:** The test at line 269 covers `getFreshAccessToken` only when the token is NOT near expiry (returns the cached token). There is no test that exercises the `now().getTime() - bundle.tokenExpiry < 60_000` branch, which triggers the actual token refresh network call and the subsequent `upsertGoogleAccount` write.
- **Impact:** The refresh branch — including the full decrypt-call-encrypt-write cycle — is not covered by the integration test suite. The concurrent refresh race condition noted above is also untestable without this branch being covered.
- **Recommendation:** Add a test that injects a `now` function returning a time 59 seconds before the stored `tokenExpiry` (making it appear near-expiry) and verifies that the fake OAuth client is called and the DB is updated with the new token.

---

## Summary Table

| # | Severity | Category | Description |
|---|----------|----------|-------------|
| 1 | LOW | Security/Architecture | Admin RLS policies bound to `jarvis_migration_owner` — dead letters; admin reads secured via SECURITY DEFINER function |
| 2 | HIGH | Security | `/authorize` endpoint has no rate limit |
| 3 | MEDIUM | Security | `connector_oauth_pending` rows have no TTL/expiry |
| 4 | LOW | Security/Error Handling | Google token error body reaches server LOG only, not HTTP response body |
| 5 | MEDIUM | Architecture | `requireAdmin` queries `app.users` on root Kysely, bypassing DataContextDb invariant |
| 6 | MEDIUM | Architecture/Security | `getFreshAccessToken` non-atomic — concurrent refresh calls can race and invalidate tokens |
| 7 | MEDIUM | TypeScript/Security | Decrypted `creds` object unsafely cast; no structural validation |
| 8 | MEDIUM | Security/Quality | Generic `tokenPayload` accepts arbitrary data of unbounded size |
| 9 | LOW | Architecture/Quality | No UNIQUE constraint on `(owner_user_id, provider_id)` in `connector_accounts` |
| 10 | LOW | Quality/Error Handling | `handleRouteError` uses fragile string-literal error message matching |
| 11 | LOW | TypeScript | `GoogleTokenResponse` cast without runtime validation at boundary |
| 12 | LOW | Architecture | Google OAuth routes absent from manifest `routes` array |
| 13 | LOW | Security | Revoke does not call Google's token revocation endpoint |
| 14 | LOW | Architecture/Quality | Manifest `migrations` list stale (missing 3 of 5 migration files) |
| 15 | INFO | TypeScript | Non-null assertion `!` on keyring key lookup |
| 16 | INFO | Architecture | `safeAccountQuery` accepts raw `Kysely` not `DataContextDb` |
| 17 | INFO | Architecture | No DELETE grant on `connector_accounts` — purge path undocumented |
| 18 | INFO | Tests | No test for `getFreshAccessToken` refresh branch (near-expiry path) |

---

## Hard Invariant Status

| Invariant | Status |
|-----------|--------|
| No admin private-data bypass (RLS applies to ALL actors) | PARTIAL — admin RLS policies are dead (bound to wrong role); runtime admin access works only via SECURITY DEFINER function, which is secure but the dead policies are misleading |
| Private by default — owner-only unless explicitly shared | PASS — `connector_accounts` RLS is strict owner-only; `connector_oauth_pending` likewise |
| DataContextDb only — no raw Kysely in repos | FAIL — `requireAdmin` in routes.ts queries `app.users` on raw `appDb`; `safeAccountQuery` accepts raw `Kysely` internally |
| AccessContext shape — `{ actorUserId, requestId }` only | PASS |
| Secrets never escape — not in responses, logs, payloads, prompts | PARTIAL — Google token error body surfaces in server LOG only, not HTTP response body |
| Metadata-only job payloads | PASS — no pg-boss payloads in this module |
| Provider-agnostic AI | N/A |
| Spec before build | N/A (audit scope) |
| Module isolation | PASS |
| pgvector image | N/A |
| Never edit applied migrations | PASS |
