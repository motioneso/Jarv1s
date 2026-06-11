## Phase 11 — Module connectors

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 2
- MED: 5
- LOW: 4
- INFO: 2

### Findings

#### [HIGH] `/google/authorize` accepts and persists an OAuth client secret with no rate limit
**File:** `packages/connectors/src/routes.ts:60-77`  
**Invariant violated / concern:** Module-focus item "Rate-limit handling" + DEVELOPMENT_STANDARDS over-exposed write surface.  
**Detail:** Only `/google/complete` carries a `config.rateLimit` (`oauthMax`, line 81-86). `/google/authorize` (line 60) takes a `clientId`/`clientSecret`, AES-encrypts them, and writes a row to `app.connector_oauth_pending` on every call — with no rate limit. Because `upsertGooglePending` deletes-then-inserts for the provider on each request (repository.ts:167-181), an authenticated caller can drive unbounded encrypt + delete/insert churn against the pending table. The endpoint that ingests a *secret* is the more sensitive of the pair, yet it is the unthrottled one. The asymmetry looks accidental: both endpoints are part of the same OAuth ceremony and both should share the `JARVIS_RL_OAUTH_MAX` budget.  
**Suggested fix:** Apply the same `config: { rateLimit: { max: oauthMax, timeWindow: "1 minute" } }` to the `/google/authorize` route.

#### [HIGH] OAuth token-endpoint error body is echoed into the thrown error message
**File:** `packages/connectors/src/oauth.ts:109-112`  
**Invariant violated / concern:** Invariant 5 (secrets never escape — into logs/errors) + module-focus "Connector errors leak OAuth details?"  
**Detail:** On a non-2xx token response, the raw provider body is interpolated into the error: `` throw new Error(`Google token endpoint returned ${response.status}: ${detail}`) ``. Google's token-endpoint error payloads can contain the submitted `client_id`, and in some failure modes reflect request parameters; this Error then propagates up through `GoogleConnectionService.completeAuthorization`/`getFreshAccessToken`. In `routes.ts:handleRouteError` (line 392-419) a plain `Error` (not `GoogleConnectError`/`HttpError`) that does not match the known-message branches is **re-thrown** (line 418), landing in Fastify's default error handler and the server log — so the verbatim Google body (with whatever it reflects) reaches logs, and depending on Fastify config may reach the client. Connector OAuth failure detail should be summarised, not passed through raw.  
**Suggested fix:** Wrap token-endpoint failures in `GoogleConnectError` with a fixed, non-reflecting message (e.g. `"Google rejected the authorization (status N)"`), log the detail only at debug level via a redacting logger, and never interpolate the provider body into a propagated Error.

#### [MED] Stale/duplicated migration list in the manifest can silently diverge from what actually runs
**File:** `packages/connectors/src/manifest.ts:33-37`  
**Invariant violated / concern:** "No stale concepts" quality rule; Invariant 11 adjacency (migration provenance).  
**Detail:** `database.migrations` lists only `sql/0009...` and `sql/0010...`, but the directory holds five migrations (0009, 0010, 0022, 0043, 0044). The runner discovers files by `readdir(...).filter(.sql).sort()` (`packages/db/src/migrations/sql-runner.ts:100-101,119-124`), so the explicit `migrations` array is **never consulted** — it is dead, now-wrong metadata. `ownedTables` (line 36) similarly omits `app.connector_oauth_pending` added in 0044. A reader trusting the manifest gets a false picture of the module's schema surface.  
**Suggested fix:** Either delete the unused `migrations` array (rely on `migrationDirectories`) or regenerate it to match the directory, and add `app.connector_oauth_pending` to `ownedTables`.

#### [MED] `decryptJson` returns `Record<string, unknown>` but callers immediately cast to concrete secret shapes with no validation
**File:** `packages/connectors/src/google-connection.ts:77-80,115`  
**Invariant violated / concern:** TypeScript dimension D (cast-heavy contracts obscuring the real invariant); error-handling dimension E (missing boundary validation).  
**Detail:** `cipher.decryptJson(...)` yields `Record<string, unknown>`, and both call sites assert structure by cast: `as { clientId; clientSecret }` (line 77) and `as GoogleConnectionSecret` (line 115). If a stored envelope is malformed or from an older shape, `creds.clientId` / `bundle.refreshToken` / `bundle.tokenExpiry` are silently `undefined` and flow into the OAuth client (`new Date(bundle.tokenExpiry)` → `Invalid Date` → token treated as expired → refresh with `refreshToken: undefined`). The branded crypto envelope guarantees *authenticity*, not *shape*. The cast hides a real runtime invariant that is never checked.  
**Suggested fix:** Add a narrow runtime validator (or a typed `decryptAs<T>(envelope, guard)` helper) that asserts the decrypted object matches `GoogleConnectionSecret` before use, throwing `GoogleConnectError` on mismatch.

#### [MED] `updateAccount` unconditionally resets `revoked_at = null`, silently un-revoking on any PATCH
**File:** `packages/connectors/src/repository.ts:115-138`  
**Invariant violated / concern:** Quality smell — ad-hoc state mutation bolted into an unrelated flow; non-atomic/surprising state transition.  
**Detail:** The base `updates` object hardcodes `revoked_at: null` (line 117). The `/accounts/:id` PATCH route (routes.ts:161-187) accepts only `scopes`/`status`/`tokenPayload` and `optionalWritableAccountStatus` forbids `"revoked"` — but any PATCH to a *currently revoked* account (e.g. just changing scopes) will set `status` to its existing/`active` value while clearing `revoked_at`, effectively un-revoking it. The DB CHECK constraint (`0009...sql:52-55`) requires `revoked` ⇒ `revoked_at NOT NULL`; this means a PATCH that leaves `status='revoked'` would actually violate the CHECK and error confusingly, while a PATCH that flips to active quietly resurrects a revoked credential. The `revoked_at: null` reset belongs only on transitions *out of* revoked, not on every update.  
**Suggested fix:** Only set `revoked_at` when `status` is explicitly provided and is non-revoked; otherwise leave it untouched. Better: reject PATCH on accounts whose current status is `revoked` (force a fresh re-auth) rather than allowing implicit un-revoke.

#### [MED] `requireAdmin` queries `app.users` via the root `appDb`, bypassing the data context
**File:** `packages/connectors/src/routes.ts:253-272`  
**Invariant violated / concern:** Invariant 3 (DataContextDb only) — spirit; architecture dimension B (layering).  
**Detail:** The admin check reads `is_instance_admin` directly off `dependencies.appDb` (a root `Kysely<JarvisDatabase>`), outside any `withDataContext` scope. Every other read in this module goes through `dataContext.withDataContext(...)` + a `DataContextDb`. Reaching for the unscoped root handle for an authz decision is exactly the pattern the DataContextDb invariant exists to prevent; it also means the admin-flag read is not subject to the actor-scoped RLS session the rest of the request uses. While functionally the lookup is keyed by `actorUserId`, the layering break is a maintainability/consistency hazard and an easy place for a future RLS-relevant `users` policy to be silently skipped.  
**Suggested fix:** Resolve the admin flag inside a `withDataContext` block (the admin-metadata function `app.list_connector_account_safe_metadata` already self-checks admin via `SECURITY DEFINER`, so the explicit pre-check could even be removed and the empty result relied upon), or route the check through a shared, context-scoped authz helper.

#### [MED] Admin-metadata RLS policies grant `SELECT` to `jarvis_migration_owner`, widening that role's runtime reach
**File:** `packages/connectors/sql/0010_connector_admin_safe_metadata.sql:4-28`  
**Invariant violated / concern:** Invariant 1 (no admin private-data bypass / least privilege) — adjacent concern.  
**Detail:** Two RLS policies (`connector_definitions_admin_metadata_select`, `connector_accounts_admin_metadata_select`) are created `TO jarvis_migration_owner`. The runtime path uses the `SECURITY DEFINER` function `app.list_connector_account_safe_metadata()` (granted to `jarvis_app_runtime`), which already enforces the admin check and only ever exposes `has_secret`, never `encrypted_secret`. These `TO jarvis_migration_owner` policies appear to be the only consumers' fallback, but the migration-owner role is the high-privilege schema role; attaching runtime-style read policies to it blurs the migration-owner-vs-runtime boundary and could let migration-owner sessions read account rows directly. Verify nothing relies on these policies at runtime; if not, they are unnecessary surface on the privileged role.  
**Suggested fix:** Confirm the `SECURITY DEFINER` function is the sole admin-metadata path and drop the `TO jarvis_migration_owner` SELECT policies if unused, or document precisely why migration-owner needs row-read access.

#### [LOW] Non-null assertion on keyring current key with no guard
**File:** `packages/connectors/src/crypto.ts:18`  
**Invariant violated / concern:** TypeScript dimension D (unjustified non-null assertion).  
**Detail:** `const key = this.keyring.keys.get(this.keyring.currentKeyId)!;` assumes the current key id is always present in the map. `resolveKeyring` does guarantee this (keyring.ts:38), so it is currently safe, but the `!` hides a cross-package invariant; a future keyring change that omits the current key would surface as a confusing `undefined`-into-`createCipheriv` crash rather than a clear error.  
**Suggested fix:** Replace with an explicit lookup-or-throw (`if (!key) throw new Error("Keyring missing current key")`), mirroring the explicit checks already used on the decrypt path (crypto.ts:68).

#### [LOW] `serializeProvider` does not coerce `default_scopes` / `provider` dates defensively, but `serializeAccount` does — inconsistent date handling
**File:** `packages/connectors/src/routes.ts:274-301,371-381`  
**Invariant violated / concern:** Code-quality smell — inconsistent serialization helpers / incidental complexity.  
**Detail:** Two near-identical date coercers exist: `serializeDate` (line 371, Date|string) and `toIsoString` (line 375, Date|string|null). `serializeAccount` uses both; `serializeProvider` uses only `serializeDate`. The split exists solely because `revoked_at` is nullable. This is minor duplication, but the two helpers differ only in null-handling and could collapse to one `toIso(value: Date | string | null): string | null` plus a non-null wrapper, removing a branch.  
**Suggested fix:** Collapse to a single nullable date coercer and derive the non-null variant from it, or inline.

#### [LOW] `getFreshAccessToken` refresh path is a non-atomic read-modify-write of the secret bundle
**File:** `packages/connectors/src/google-connection.ts:110-135`  
**Invariant violated / concern:** Quality rule — non-atomic multi-step update that can leave half-applied state; concurrency.  
**Detail:** The method reads the active account secret, refreshes the token over the network, then `upsertGoogleAccount` writes the new bundle. Two concurrent callers for the same user both pass the 60s-expiry check, both call Google's refresh endpoint, and both write — the later write wins. Google may invalidate the earlier-issued access token on a second refresh, so a racing caller can be handed a token that is about to be (or already) invalidated. No row lock / `FOR UPDATE` / single-flight guard exists. For a single-user-at-a-time desktop flow this is low impact, but the function is the designated cross-module token accessor.  
**Suggested fix:** Serialize refreshes per account (e.g. `SELECT ... FOR UPDATE` on the account row inside the same scoped transaction, re-checking expiry after acquiring the lock) or a per-account in-process single-flight.

#### [LOW] `requireObject` / `requiredJsonObject` are duplicate validators with identical bodies
**File:** `packages/connectors/src/routes.ts:303-317`  
**Invariant violated / concern:** Code-quality — bespoke helper duplicating a sibling helper.  
**Detail:** `requireObject` (line 303) and `requiredJsonObject` (line 311) have byte-identical validation logic; they differ only in error message ("Expected JSON object body" vs `${fieldName} must be a JSON object`). Two functions for one check.  
**Suggested fix:** Single `requireObject(value, label = "body")` parameterised on the label.

#### [INFO] Core secret-at-rest and RLS invariants verified clean
**File:** `packages/connectors/src/crypto.ts:14-92`, `packages/connectors/sql/0009_connectors_module.sql:135-186`, `packages/connectors/sql/0044_google_unified_connection.sql:46-69`  
**Invariant violated / concern:** Invariants 1–6, 10–11 — verified, no finding.  
**Detail:** Connector/OAuth secrets are AES-256-GCM enveloped via the shared keyring before any DB write (crypto.ts; `encryptedSecret` flows through `repository`/`google-connection`). All three tables (`connector_accounts`, `connector_oauth_pending`, `connector_definitions`) have `ENABLE`+`FORCE` RLS with owner-scoped (`owner_user_id = app.current_actor_user_id()`) SELECT/INSERT/UPDATE/DELETE policies on `jarvis_app_runtime`; no `BYPASSRLS`. The DTO (`serializeAccount`) exposes only `hasSecret: boolean`, never the envelope — no token material reaches the frontend. No pg-boss job payloads are produced by this module (no sync jobs yet), so the metadata-only payload invariant is not exercised. Cross-user isolation is enforced at the DB layer; an actor cannot read or mutate another user's account/pending rows. `0044` correctly seeds the catalog under a transient migration-owner policy and drops it; `0043` correctly isolates the enum-add into its own transaction.  
**Suggested fix:** None. Add a dedicated negative RLS test (userB cannot read userA's connector_account) — see Tests note below.

#### [INFO] Test coverage is meaningful but lacks an explicit cross-user RLS denial case
**File:** `tests/integration/connectors-google.test.ts:120-302`  
**Invariant violated / concern:** Tests dimension G (RLS actually tested / coverage gap).  
**Detail:** Integration tests run against the real Postgres (`resetFoundationDatabase`, real `DataContextRunner`), assert the secret round-trips and that the guidance tool leaks no `clientSecret`/`accessToken`, and cover OAuth happy/error paths and route auth (401/400/201). However all DB-touching cases use a single actor (`userA`); there is no test that `userB` is *denied* visibility of `userA`'s `connector_account` or `connector_oauth_pending` row. The strongest invariant of this module (owner-only secret isolation) is therefore enforced by SQL but not regression-guarded by a test.  
**Suggested fix:** Add a test that creates an account as `userA`, then asserts `listAccounts` / `getActiveGoogleAccountSecret` under `userB`'s `AccessContext` returns empty / undefined.
