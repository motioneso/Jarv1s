# packages/auth — Thermo-Nuclear Quality Audit

**Scope:** `packages/auth/src/index.ts`, `packages/db/src/auth-session.ts`,
`infra/postgres/bootstrap/0000_roles.sql`,
`infra/postgres/migrations/0045_auth_secret_rls.sql`,
`infra/postgres/migrations/0046_auth_sessions_rls.sql`,
`infra/postgres/migrations/0001_app_schema.sql`,
`infra/postgres/migrations/0002_app_rls.sql`,
`infra/postgres/migrations/0004_auth_workspaces_settings.sql`,
`infra/postgres/migrations/0005_admin_audit_events.sql`,
`apps/api/src/server.ts` (auth wiring), `scripts/export-user-data.ts`,
`tests/integration/auth-settings.test.ts`,
`tests/integration/api-rate-limit.test.ts`

**Date:** 2026-06-10

---

## Summary

The auth module's defense-in-depth posture is materially strong. The
`jarvis_auth_runtime` role separation, FORCE RLS on all auth-secret tables,
and the `SECURITY DEFINER` helper pattern (`resolve_auth_session`,
`count_all_users`) are well-engineered. The rate-limit wiring in `server.ts`
correctly keys on real peer IP and prevents XFF spoofing.

Nine findings follow. Two are HIGH (one in security, one in architecture),
the remainder are MEDIUM, LOW, or INFO.

---

## Findings

### [HIGH] OIDC issuer validation is off-by-default with no production guard

- **File:** `packages/auth/src/index.ts:447-448`
- **Category:** Security
- **Finding:** The `readOidcProviderConfig` function passes `requireIssuerValidation:
  readBoolean(env, "JARVIS_AUTH_OIDC_REQUIRE_ISSUER_VALIDATION")` directly to
  `genericOAuth`. When the variable is absent (the common case), `readBoolean`
  returns `undefined`, which is silently passed as `undefined` to better-auth's
  `genericOAuth`. The field name is `requireIssuerValidation`; in most OIDC
  libraries `undefined` is treated as "framework default" — typically `false` or
  library-version-dependent. There is no explicit `true` default and no production
  guard that forces it on.
- **Evidence:**
  ```ts
  requireIssuerValidation: readBoolean(env, "JARVIS_AUTH_OIDC_REQUIRE_ISSUER_VALIDATION"),
  ```
  `readBoolean` returns `undefined` when key is absent; `issuer` (line 447) is
  also `undefined` when `JARVIS_AUTH_OIDC_ISSUER` is not set.
- **Impact:** A malicious OIDC provider (or a misconfigured multi-tenant IdP)
  could issue tokens with a different issuer claim and the server would accept
  them, enabling cross-tenant identity injection. This is a known OIDC attack
  class.
- **Recommendation:** Default `requireIssuerValidation` to `true` explicitly.
  Require `JARVIS_AUTH_OIDC_ISSUER` whenever OIDC is configured and throw if
  missing (the same pattern already used for `discoveryUrl`). Validate in the
  release-hardening audit script.

---

### [HIGH] `admin_audit_events`, `workspaces`, `workspace_memberships`, `resource_grants`, `instance_settings` have no RLS

- **File:** `infra/postgres/migrations/0005_admin_audit_events.sql:18-20`,
  `infra/postgres/migrations/0004_auth_workspaces_settings.sql:79-93`,
  `infra/postgres/migrations/0001_app_schema.sql:72`
- **Category:** Security / Architecture
- **Finding:** Five tables with sensitive multi-user data have `GRANT SELECT/INSERT/UPDATE`
  to `jarvis_app_runtime` but no `ENABLE ROW LEVEL SECURITY`, no `FORCE ROW LEVEL
  SECURITY`, and no policies. At the DB layer, any transaction running as
  `jarvis_app_runtime` (regardless of the `app.actor_user_id` GUC) can
  SELECT/mutate all rows in all five tables. The only protection is the
  application-layer admin check in the Fastify routes.
  - `app.admin_audit_events` — exposes all users' admin actions
  - `app.workspaces` — exposes all workspace names and ownership
  - `app.workspace_memberships` — exposes all membership relationships
  - `app.resource_grants` — exposes all sharing grants
  - `app.instance_settings` — exposes instance-wide configuration
- **Evidence:**
  ```sql
  GRANT SELECT, INSERT ON app.admin_audit_events TO jarvis_app_runtime;
  -- No: ALTER TABLE app.admin_audit_events ENABLE ROW LEVEL SECURITY;
  -- No: CREATE POLICY ... ON app.admin_audit_events ...;
  ```
  Confirmed by exhaustive scan: `grep -i "ENABLE ROW LEVEL" infra/postgres/migrations/*.sql`
  returns no match for any of these five tables.
- **Impact:** A future bug that accidentally bypasses the route-layer admin check
  (missing auth guard, route ordering error, test helper left wired in) would expose
  all tenants' admin surfaces with no DB-layer backstop. The project's stated
  security posture is "DB-level defense-in-depth (RLS + least-priv roles), not
  conventions" (memory: `feedback-security-first`). These tables violate that posture.
- **Recommendation:** Add `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`
  to all five tables in a new migration. Policies for `admin_audit_events`,
  `workspaces`, `workspace_memberships`, `resource_grants`, and `instance_settings`
  should scope reads to `jarvis_app_runtime` only when the actor is an instance admin
  (detectable via a `SECURITY DEFINER` function checking `app.users.is_instance_admin`),
  mirroring the route-layer guard at the DB layer. This is the same pattern already
  applied to auth-secret tables in 0045/0046.

---

### [MEDIUM] `BETTER_AUTH_SECRET` production check does not guard `JARVIS_AUTH_BASE_URL` — cookie `Secure` flag may be absent in production

- **File:** `packages/auth/src/index.ts:133`, `packages/auth/src/index.ts:354-366`
- **Category:** Security
- **Finding:** `readAuthSecret` throws when `NODE_ENV=production` and the secret
  is unset. No equivalent guard exists for `JARVIS_AUTH_BASE_URL`. When this
  variable is absent (or when it defaults to `http://localhost:3000` in production),
  better-auth derives the cookie `Secure` attribute from the scheme of `baseURL`.
  An `http://` baseURL causes better-auth to issue session cookies without the
  `Secure` flag, making them transmittable over plain HTTP connections in browsers
  that allow it.
- **Evidence:**
  ```ts
  baseURL: env.JARVIS_AUTH_BASE_URL ?? env.BETTER_AUTH_URL ?? "http://localhost:3000",
  ```
  No `https://` enforcement; the release-hardening test (`release-hardening.test.ts:368`)
  only verifies that the variable is listed in the env example file, not that it
  is set or uses HTTPS.
- **Impact:** Session cookie interception in a scenario where TLS termination is
  upstream and `JARVIS_AUTH_BASE_URL` was accidentally left as `http://`.
- **Recommendation:** In `readAuthSecret` (or a new `validateProductionConfig`
  function called at startup), when `NODE_ENV=production`, additionally assert
  that `JARVIS_AUTH_BASE_URL` (or `BETTER_AUTH_URL`) starts with `https://`. Add
  this check to the release-hardening audit script.

---

### [MEDIUM] `bootstrapFirstJarvisUser` uses raw `Kysely<JarvisDatabase>` (`appDb`) not `DataContextDb`

- **File:** `packages/auth/src/index.ts:233-307`
- **Category:** Architecture
- **Finding:** The `bootstrapFirstJarvisUser` function receives `appDb:
  Kysely<JarvisDatabase>` (the raw instance from server.ts, running as
  `jarvis_app_runtime`) and opens its own transaction directly via
  `appDb.transaction().execute(...)`. This bypasses the `DataContextDb` brand and
  the `DataContextRunner.withDataContext` pattern. The hard invariant in CLAUDE.md
  states: "Repositories accept only a branded `DataContextDb` handle, never a root
  Kysely instance."
- **Evidence:**
  ```ts
  async function bootstrapFirstJarvisUser(
    appDb: Kysely<JarvisDatabase>,  // raw Kysely, not DataContextDb
    user: BetterAuthUser
  ): Promise<void> {
    await appDb.transaction().execute(async (transaction) => {
      // Manually calling set_config — duplicating DataContextRunner logic
      await sql`SELECT set_config('app.actor_user_id', ${user.id}, true)`.execute(transaction);
  ```
- **Impact:** The manual `set_config` call duplicates `DataContextRunner`'s
  established pattern and can drift from it (e.g., if `app.request_id` is ever
  added as a required GUC, this path would miss it silently). The invariant exists
  precisely to prevent this drift.
- **Recommendation:** The bootstrap is unique: it runs inside a better-auth
  `databaseHook.user.create.after` callback where `DataContextRunner` is not
  naturally available. The correct fix is to accept a `DataContextRunner` instance
  in `createJarvisAuthRuntime` and call `dataContext.withDataContext({ actorUserId:
  user.id, requestId: 'bootstrap:...' }, ...)` inside the hook — removing the manual
  `set_config`. If the advisory lock complicates this, encapsulate that in a helper
  that still accepts `DataContextDb`. The function may also need to be extracted to
  a testable standalone module.

---

### [MEDIUM] Rate-limit `THROTTLED_AUTH_PATHS` set does not cover all credential endpoints

- **File:** `apps/api/src/server.ts:157-163`
- **Category:** Security
- **Finding:** The set of throttled POST paths is defined as a static constant and
  covers five paths. It does not cover `verify-email`, `sign-in/magic-link` (if
  enabled by a future better-auth plugin), or social-provider token exchange paths
  that better-auth might expose as POST. More concretely for the current surface:
  `/api/auth/email/verify-otp` (if OTP plugin is ever added) or
  `/api/auth/update-user` (password update) would not be throttled by default
  without updating this list.
- **Evidence:**
  ```ts
  const THROTTLED_AUTH_PATHS = new Set([
    "/api/auth/sign-in/email",
    "/api/auth/sign-up/email",
    "/api/auth/forget-password",
    "/api/auth/reset-password",
    "/api/auth/change-password"
  ]);
  ```
  The current list was written to match better-auth 1.6.x's email+password surface.
  Any new better-auth plugin that adds credential POST endpoints is an accidental
  omission.
- **Impact:** New credential endpoints would be unthrottled until the set is
  manually updated. This is a maintenance trap: the set is far from the plugin
  registration code and has no compile-time linkage to better-auth's route table.
- **Recommendation:** Invert the allowList logic: throttle ALL POST requests to
  `/api/auth/*` and maintain an explicit `UNTHROTTLED_AUTH_PATHS` allowlist of
  safe paths (e.g., `get-session`, OAuth callbacks). This way, new endpoints are
  throttled by default and must be explicitly opted out.

---

### [MEDIUM] `AuthenticatedPrincipal` interface is exported but never consumed

- **File:** `packages/auth/src/index.ts:20-22`
- **Category:** Code Quality
- **Finding:** `export interface AuthenticatedPrincipal { readonly userId: string; }`
  is part of the public API surface but is not imported or used anywhere in the
  codebase. The module's actual auth result type is `AccessContext` (from `@jarv1s/db`).
- **Evidence:**
  ```ts
  export interface AuthenticatedPrincipal {
    readonly userId: string;
  }
  ```
  A project-wide grep for `AuthenticatedPrincipal` returns only this definition.
- **Impact:** Dead exports widen the module's public API unnecessarily, invite
  future confusion (which type represents a resolved user?), and create the false
  impression that `userId` (string) is the canonical user identifier rather than
  `actorUserId` (the term used in `AccessContext`).
- **Recommendation:** Remove `AuthenticatedPrincipal`. If a future feature needs a
  principal type, add it at that point with a clear relationship to `AccessContext`.

---

### [MEDIUM] `RlsProbeItemsTable` type is missing `workspace_id` and `visibility` columns

- **File:** `packages/db/src/types.ts:136-141`
- **Category:** TypeScript / Architecture
- **Finding:** The `RlsProbeItemsTable` interface in `types.ts` declares only four
  columns (`id`, `owner_user_id`, `body`, `created_at`). The actual SQL table
  (`0001_app_schema.sql:50-57`) has two additional columns: `workspace_id uuid`
  and `visibility app.rls_probe_visibility`. The Kysely type therefore does not
  match the live schema, meaning any query that filters or reads these columns
  would require casting around the type system.
- **Evidence:**
  ```ts
  // packages/db/src/types.ts:136
  export interface RlsProbeItemsTable {
    id: string;
    owner_user_id: string;
    body: string;
    created_at: TimestampColumn;
    // workspace_id and visibility are MISSING
  }
  ```
  ```sql
  -- infra/postgres/migrations/0001_app_schema.sql:50-57
  CREATE TABLE IF NOT EXISTS app.rls_probe_items (
    id uuid PRIMARY KEY,
    owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    workspace_id uuid,
    visibility app.rls_probe_visibility NOT NULL DEFAULT 'private',
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ```
- **Impact:** Structural unsoundness in the Kysely database types. Any code that
  queries `workspace_id` or `visibility` on probe items will either be caught by
  TypeScript (breaking the build) or will use unsafe casts. The RLS policy in
  `0002_app_rls.sql:112` actively references these columns, meaning the probe
  test suite's visibility/workspace tests bypass type safety.
- **Recommendation:** Add `workspace_id: string | null` and `visibility:
  'private' | 'workspace'` to `RlsProbeItemsTable`. These are present in the SQL
  type (`app.rls_probe_visibility`) and in the RLS policy, so the Kysely type
  should reflect them.

---

### [LOW] Dual session tables (`auth_sessions` + `better_auth_sessions`) with no documented lifecycle for the legacy table

- **File:** `infra/postgres/migrations/0001_app_schema.sql:26-31`,
  `packages/db/src/types.ts:38-44`
- **Category:** Architecture / Code Quality
- **Finding:** Two distinct session tables coexist in the schema. `app.auth_sessions`
  (legacy bearer-token sessions, migration 0001) is now locked down with FORCE RLS
  and exposed only via `app.resolve_auth_session()` (migration 0046). `app.better_auth_sessions`
  (better-auth cookie sessions, migration 0004) is similarly locked. Code inspection
  shows no application code performs `INSERT` into `app.auth_sessions`; the table is
  only read via the SECURITY DEFINER function. There is no migration that DROP-creates
  new sessions in it, no TypeScript code that writes to it, and no documentation of
  when (if ever) this table will be retired.
- **Evidence:**
  A project-wide search for `"app.auth_sessions"` in TypeScript source returns only
  the type definition in `types.ts` and a comment in `auth-session.ts`. No INSERT
  is performed in any `.ts` file outside node_modules.
- **Impact:** Dead schema surface. The table is locked down (low security risk now)
  but its purpose and eventual retirement path are undocumented. A future developer
  may not know whether the table is live or historical. The `AuthSessionsTable`
  Kysely type and the `JarvisDatabase` mapping entry are dead weight.
- **Recommendation:** If `app.auth_sessions` is no longer written by any application
  path, document this explicitly in a migration comment and add a future migration
  to drop the table (after confirming no active sessions remain). If it is still
  written by some out-of-band path (e.g., CLI bridge), document that path. Remove
  `AuthSessionsTable` and its `JarvisDatabase` mapping entry when the table is dropped.

---

### [LOW] `listConfiguredAuthProviders` is exported as a standalone function alongside `createJarvisAuthRuntime` — unnecessary API surface duplication

- **File:** `packages/auth/src/index.ts:73-120`
- **Category:** Code Quality
- **Finding:** `listConfiguredAuthProviders` is both exported as a named function
  and surfaced as `listConfiguredProviders` on the `JarvisAuthRuntime` interface
  (line 33). The route wiring in `apps/api/src/server.ts` (line 101) correctly
  uses the runtime interface: `listConfiguredProviders: authRuntime.listConfiguredProviders`.
  The standalone export is not used anywhere outside tests that directly call the
  runtime factory.
- **Evidence:**
  ```ts
  export function listConfiguredAuthProviders(
    env: NodeJS.ProcessEnv = process.env
  ): readonly AuthProviderStatusDto[] { ... }
  ```
  No import of `listConfiguredAuthProviders` (as a standalone function) exists
  outside `packages/auth/src/index.ts` itself (where it is called inside the
  runtime factory).
- **Impact:** Dual access path for the same capability widens the public API and
  makes it possible to call the function outside an auth-runtime lifecycle context
  (e.g., without the env snapshot that the runtime was initialized with).
- **Recommendation:** Keep `listConfiguredAuthProviders` private (remove the
  `export` keyword). The runtime interface method is the canonical access point.

---

### [INFO] Development default password for DB roles is identical in bootstrap and URL fallbacks — no rotation concern at runtime but worth tracking

- **File:** `infra/postgres/bootstrap/0000_roles.sql:4-24`,
  `packages/db/src/urls.ts:20-29`
- **Category:** Security / INFO
- **Finding:** The bootstrap SQL hardcodes role passwords (`migration_password`,
  `app_password`, `worker_password`, `auth_password`) and the URL fallback in
  `urls.ts` uses the same literal strings. The release-hardening test
  (`release-hardening.test.ts:383-387`) correctly asserts that these strings must
  not appear in `infra/env.production.example`. This means they are dev-only
  defaults.
- **Evidence:**
  ```ts
  `postgres://jarvis_auth_runtime:auth_password@${host}:${port}/${database}`
  ```
- **Impact:** Low in isolation because production deployments are required to
  override all URLs via `JARVIS_AUTH_DATABASE_URL` etc. Risk increases if the env
  example check is ever weakened, or if a staging environment is provisioned from
  the default compose file without overriding credentials.
- **Recommendation:** No immediate action required. Confirm the release-hardening
  smoke test (`pnpm smoke:compose`) exercises a non-default-password configuration
  and that CI is green before each release.

---

## Not Found / Confirmed Clean

- **No BYPASSRLS on any runtime role**: All four runtime roles have `NOBYPASSRLS`
  in `0000_roles.sql`. Confirmed.
- **No secrets in session cookie content**: better-auth cookies carry a session ID
  only; the `BetterAuthSessionsTable.token` is stored in the DB, not re-exposed
  via API responses.
- **No secrets in `resolve_auth_session` return**: The SECURITY DEFINER function
  returns only `user_id`, never the session ID or token value.
- **No `workspaceId` in `AccessContext`**: `AccessContext` is `{ actorUserId,
  requestId }` only. The `withDataContext` implementation sets exactly these two
  GUCs and no more.
- **PKCE enforced for OIDC**: `genericOAuth` config sets `pkce: true` (line 450).
  Built-in Google/GitHub/Microsoft social providers use better-auth's built-in PKCE
  and state handling.
- **Password hashing**: better-auth 1.6.x uses argon2id via the `oslo` library by
  default. No custom hasher is configured, so the secure default applies.
- **Session expiry**: Delegated entirely to better-auth's built-in session
  management (the `better_auth_sessions.expires_at` column). No custom expiry
  logic that could regress.
- **User export**: `scripts/export-user-data.ts` correctly omits raw secrets
  (password hash, access/refresh tokens) from `authAccountsQuery` — exports boolean
  presence flags (`hasPassword`, `hasAccessToken`) only. Session tokens are also
  omitted from `betterAuthSessionsQuery`. Confirmed.
- **Rate limit XFF bypass closed**: `apps/api/src/server.ts:64` keys the rate
  limiter on `request.ip` (peer IP after Fastify proxy resolution), not on
  `X-Forwarded-For`. The regression test in `api-rate-limit.test.ts:157-190`
  confirms this.
- **Trusted origins not a wildcard**: `readTrustedOrigins` splits on `,` and
  filters blank strings; no wildcard expansion. The default is a fixed localhost
  origin.
- **Bearer token path**: `readBearerToken` throws `"Invalid bearer token"` (not
  returning a partial token) when the Authorization header is malformed. The chat
  route maps this to 401 correctly.
- **`jarvis_auth_runtime` is the sole writer to auth-secret tables**: Confirmed by
  the REVOKE in migration 0045 (removes `jarvis_app_runtime` access to
  `auth_accounts`, `better_auth_sessions`, `auth_verifications`) and migration 0046
  (removes access to `auth_sessions`). All four tables have FORCE RLS with policies
  restricted to `jarvis_auth_runtime` only.
