## Phase 6 — Module auth

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 2
- MED: 4
- LOW: 3
- INFO: 2

### Findings

#### [HIGH] Parallel bearer-token auth path is unconditionally live in production
**File:** `packages/auth/src/index.ts:215-219`  
**Invariant violated / concern:** Test seam leaked into production auth surface; dual authentication paths (incidental-complexity / attack-surface smell). Also Hard Invariant 5 (defense-in-depth) — this path sidesteps the cookie/origin protections of better-auth.  
**Detail:** `resolveRequestAccessContext` checks for an `Authorization: Bearer <token>` header *first*, and if present resolves the actor purely via `AuthSessionResolver` → `app.resolve_auth_session(uuid)` against the `auth_sessions` table — bypassing better-auth's session/cookie machinery, `trustedOrigins` CSRF protection, and `getSession` entirely. The only writers to `auth_sessions` are the test harness (`tests/integration/test-database.ts:84`); no production code seeds it. So this is a test-only authentication mechanism that is nonetheless compiled and reachable in every deployment, gated by nothing (no `NODE_ENV`, no feature flag). It is checked *before* the better-auth route handlers, so it also sits outside the better-auth rate-limit (`AUTH_MAX`, `apps/api/src/server.ts:95`). Any party able to insert a row into `auth_sessions` (or any future code that reuses this table) obtains a bearer credential that needs only a raw UUID, no cookie, no origin check. A bearer-first auth path that exists primarily for tests is exactly the kind of "mode bolted into an unrelated flow" the thermo-nuclear bar targets.  
**Suggested fix:** Gate the bearer path behind an explicit non-production flag (e.g. only register `legacySessions` resolution when `env.JARVIS_ALLOW_BEARER_SESSIONS === "1"`, defaulted off and forbidden when `NODE_ENV === "production"`), or move the test-session injection into the test harness so the production `resolveRequestAccessContext` collapses to the single better-auth path. Deleting the branch in production removes a whole authentication mode and its `auth_sessions`/`resolve_auth_session` surface from the live attack surface.

#### [HIGH] Bootstrap writes to `app.users`/`workspaces` via app_runtime using a self-set actor GUC inside a better-auth hook
**File:** `packages/auth/src/index.ts:233-307`  
**Invariant violated / concern:** Hard Invariant 4 (AccessContext shape — workspaceId permanently removed) is contradicted by live `workspaces`/`workspace_memberships` writes; Hard Invariant 1/2 (RLS as the real boundary, not application-set GUCs) is strained by `set_config('app.actor_user_id', user.id, true)` being chosen by the auth layer rather than derived from a verified session.  
**Detail:** `bootstrapFirstJarvisUser` runs on the better-auth `user.create.after` hook using the **app_runtime** pool (`appDb`), not auth_runtime. It manually sets `app.actor_user_id` to the freshly created `user.id` so the self-row RLS UPDATE on `app.users` passes, then inserts a `Personal` workspace + `owner` membership. Two problems: (1) the workspace concept was supposedly retired with `workspaceId` from `AccessContext` (Slice 1f per CLAUDE.md), yet this code still creates `app.workspaces` / `app.workspace_memberships` on every first user — either the invariant note is stale or this is dead scaffolding being actively written (see also LOW below). (2) The pattern of the auth layer choosing and asserting an actor GUC to satisfy RLS, rather than the data-context layer deriving it from a verified `AccessContext`, is an RLS-bypass-by-convention: it works only because the value happens to equal the row being written. This is feature/bootstrap logic living in the auth module and reaching directly into `app.users`/`workspaces` tables, which is a module-isolation and layering concern (Hard Invariant 9 — auth reaching into app domain tables).  
**Suggested fix:** Move first-user bootstrap out of the auth module into the app/data-context layer behind a real `AccessContext`, exposed as a single SECURITY DEFINER `app.bootstrap_user(...)` (mirroring `count_all_users`) so the auth hook does not hand-set the actor GUC or touch domain tables directly. If `workspaces`/`workspace_memberships` are truly retired, delete those inserts (and the table writes) entirely — that removes ~35 lines and a stale domain concept in one pass.

#### [MED] Malformed bearer token throws a raw Postgres uuid-cast error to the boundary
**File:** `packages/db/src/auth-session.ts:17-19`  
**Invariant violated / concern:** Error handling — leaked internals / unclear boundary validation; review dimension E.  
**Detail:** `resolve_auth_session` casts the token with `${sessionId}::uuid`. A bearer token that is non-empty but not a UUID (e.g. `Authorization: Bearer abc`) passes `readBearerToken` (which only checks scheme + non-empty), reaches the SQL, and Postgres throws `invalid input syntax for type uuid: "abc"` rather than the intended `"Session is missing or expired"`. Depending on the Fastify error handler this can surface a 500 with a DB error string instead of a clean 401, and conflates "malformed credential" with "server error". `readBearerToken` also throws (not returns) for a missing scheme, so a stray `Authorization` header becomes an exception rather than an auth failure.  
**Suggested fix:** Validate the token shape (UUID regex) in `readBearerToken`/`AuthSessionResolver` and return the standard "missing or expired" failure for any non-UUID token; ensure the auth-failure path produces a 401 with a generic message, never the raw cast error. (Becomes moot if the bearer path is removed per the HIGH finding.)

#### [MED] `auth.api.getSession` failures are indistinguishable and produce a generic thrown Error, not a typed auth result
**File:** `packages/auth/src/index.ts:221-231`  
**Invariant violated / concern:** Error handling / contract clarity — `resolveAccessContext` signals all auth failures via `throw new Error("Session is missing or expired")`, a stringly-typed control-flow signal.  
**Detail:** The only failure channel is a bare `Error` with a message string. Callers (`apps/api/src/server.ts:199`, route guards) cannot distinguish "no session" from "expired" from "better-auth threw internally" without string-matching, and any better-auth internal throw (DB down, decode error) propagates as the same opaque error, risking a 500 where a 401 is correct or vice versa. This is the over-defensive/under-typed boundary smell: an auth resolver should return a discriminated result or throw a dedicated typed `AuthError`, not a generic `Error`.  
**Suggested fix:** Introduce a small `AuthError` (or return `AccessContext | null` and let the caller map null→401) so the API layer can map authentication failure to 401 deterministically and reserve 500 for genuine infrastructure faults.

#### [MED] `socialProviders` is typed via repeated `NonNullable<BetterAuthOptions["socialProviders"]>` and built with mutation — provider config drift risk
**File:** `packages/auth/src/index.ts:375-417`  
**Invariant violated / concern:** Code quality — incidental complexity / cast-heavy contract that obscures the real shape; Hard Invariant 7 adjacency (provider-agnostic) is fine here but the hand-rolled per-provider branching is brittle.  
**Detail:** `readSocialProviders` allocates an empty object typed as `NonNullable<BetterAuthOptions["socialProviders"]>` then mutates it provider-by-provider, with Microsoft uniquely threading `tenantId`/`authority`. The three OAuth providers and the OIDC provider share an identical "read a credential pair, conditionally register" shape but are expressed as four bespoke branches across `readSocialProviders`, `readAuthPlugins`, `readOidcProviderConfig`, and the parallel `listConfiguredAuthProviders` (lines 73-120). The provider list is therefore maintained in *two* places (the status DTO list and the actual registration), so adding/removing a provider requires edits in both, with no compiler link between them — a classic drift bug waiting to happen.  
**Suggested fix:** Define one provider descriptor table (id, displayName, type, env-key pair, optional extra-field reader) and derive *both* `listConfiguredAuthProviders` and the better-auth `socialProviders`/`plugins` from it. That collapses ~80 lines of near-duplicated branching into a single source of truth and makes the status DTO provably consistent with what is actually registered.

#### [MED] Dev fallback auth secret is a hard-coded constant
**File:** `packages/auth/src/index.ts:354-366`  
**Invariant violated / concern:** Hard Invariant 5 (secrets) — a predictable static signing secret in non-production.  
**Detail:** When `BETTER_AUTH_SECRET`/`AUTH_SECRET` are unset and `NODE_ENV !== "production"`, the runtime falls back to the literal `"jarv1s-development-better-auth-secret"`. The production guard is good, but `NODE_ENV` is frequently unset (undefined) in CI, LAN dev exposed via `--host` (per project memory the dev box is headless and Vite runs with `--host`), and ad-hoc staging — in all of those the signing key for every session/CSRF token is a value committed to the repo. Anyone who reads this source can forge sessions against any non-`production` instance reachable on the LAN.  
**Suggested fix:** Treat a missing secret as fatal in *all* modes except an explicit `JARVIS_DEV=1` local-only opt-in, or derive a per-boot random secret in dev (accepting that sessions reset on restart). At minimum, refuse to bind to a non-loopback host with the default secret.

#### [LOW] Stale `workspaces` domain concept still written by auth bootstrap despite documented removal
**File:** `packages/auth/src/index.ts:269-289`  
**Invariant violated / concern:** No-stale-concepts quality rule — dead vocabulary/scaffolding not removed with the feature.  
**Detail:** CLAUDE.md states `workspaceId` was *permanently removed* from `AccessContext` in Slice 1f, yet first-user bootstrap still creates `app.workspaces` and `app.workspace_memberships`. Either workspaces are live (in which case the CLAUDE.md invariant is misleading) or they are vestigial writes that should have been deleted. Carrying a half-retired concept in the auth bootstrap is exactly the stale-scaffolding smell.  
**Suggested fix:** Confirm the workspace model's status; if retired, delete these inserts and the tables; if live, correct the CLAUDE.md/AccessContext note. Do not leave it ambiguous.

#### [LOW] `resolveRequestAccessContext` performs an `await` before a synchronous header parse it could fail fast on
**File:** `packages/auth/src/index.ts:213-221`  
**Invariant violated / concern:** Code quality — minor ordering / clarity.  
**Detail:** `toWebHeaders` and `readBearerToken` are synchronous and can throw `"Invalid bearer token"`; the better-auth `getSession` await only happens when no bearer is present. The flow is correct, but `readBearerToken` mixes two outcomes (return-undefined for "no header", throw for "malformed header") which makes the caller's control flow harder to reason about — a malformed `Authorization` value becomes an exception rather than falling through to cookie auth.  
**Suggested fix:** Make `readBearerToken` total (return `undefined` for anything that is not a well-formed `Bearer <token>`), letting genuinely malformed headers fall through to better-auth cookie resolution or a single clean 401, rather than a distinct thrown string.

#### [LOW] `auth: ReturnType<typeof betterAuth>` leaks the entire better-auth surface through the public runtime type
**File:** `packages/auth/src/index.ts:29-34`  
**Invariant violated / concern:** Module isolation / contract clarity (Hard Invariant 9) — public API exposes a vendor type rather than a narrowed capability.  
**Detail:** `JarvisAuthRuntime.auth` is typed as the full better-auth instance and is consumed in `apps/api/src/server.ts:238` via `authRuntime.auth.handler(...)`. Exposing the whole better-auth object as part of the module's public contract couples every consumer to better-auth internals and makes future provider swaps (the project's stated "pluggable chat adapter / provider-agnostic" ethos) harder — any consumer can reach `auth.api.*` directly.  
**Suggested fix:** Narrow the public surface to exactly what consumers need (e.g. `handler(request: Request): Promise<Response>` and the already-exposed `resolveAccessContext`), keeping the raw better-auth instance private to the module.

#### [INFO] Role separation and RLS for auth tables reviewed — clean
**File:** `packages/auth/src/index.ts:52-56`  
**Invariant violated / concern:** None (positive confirmation).  
**Detail:** The auth pool connects exclusively as `jarvis_auth_runtime` (`getJarvisDatabaseUrls(env).auth`, `urls.ts:24-26`) with `search_path=app,public`, and migrations 0045/0046 correctly FORCE RLS on `users`, `auth_accounts`, `better_auth_sessions`, `auth_sessions`, and `auth_verifications`, restricting them to `jarvis_auth_runtime` with no `BYPASSRLS`. Cross-role reads go through SECURITY DEFINER functions (`app.count_all_users`, `app.resolve_auth_session`) that return only `user_id`/counts — never tokens or hashes. This satisfies Hard Invariants 1, 5, and the auth-secret RLS design. No secrets are logged or returned to the frontend from this module.  
**Suggested fix:** None. Keep the `jarvis_auth_runtime`-only invariant under test (verify a negative: app_runtime cannot SELECT `better_auth_sessions`/`auth_accounts` directly).

#### [INFO] Password hashing algorithm/cost not configured in this module — defers to better-auth default
**File:** `packages/auth/src/index.ts:136-138`  
**Invariant violated / concern:** None directly; flagged for verification (review dimension A).  
**Detail:** `emailAndPassword: { enabled: true }` sets no `password.hash`/`password.verify` override, so hashing uses better-auth's built-in default (scrypt-based in better-auth ^1.6.14). The module never stores or reads the hash itself (it lives in `auth_accounts`, RLS-locked to auth_runtime), so there is no leak here. This is acceptable, but the cost parameters are entirely implicit and would silently change on a better-auth upgrade.  
**Suggested fix:** Either explicitly pin the password KDF/cost in `emailAndPassword.password` so it is auditable and upgrade-stable, or add a test asserting the stored hash format, so a better-auth default change cannot silently weaken hashing.
