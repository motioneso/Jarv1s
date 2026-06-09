# Plan — P1 #52: Close the auth-secret RLS gap

**Branch:** `p1-auth-secret-rls`  
**Spec:** `docs/superpowers/specs/2026-06-09-p1-auth-secret-rls.md`  
**Migration number:** `0045` (confirmed: highest on-disk is `0044_google_unified_connection.sql`)  
**Coordinator label:** `Coordinator`  

---

## Context notes from exploration

1. **`AuthSessionResolver` reads `app.auth_sessions`** (not `better_auth_sessions` as the spec text
   implies). It does an inner join on `users` purely for validation — redundant because the FK has
   `ON DELETE CASCADE`. Removing the join is the minimal, correct fix. No SECURITY DEFINER needed.

2. **`bootstrapFirstJarvisUser` uses `appDb` (jarvis_app_runtime).** With FORCE RLS on `users` and
   no actor set, the count query returns 0, breaking first-user detection. Fix: create a
   `SECURITY DEFINER` function `app.count_all_users()` owned by `jarvis_auth_runtime` (which has a
   `USING (true)` policy on users). Bootstrap calls this function through the appDb transaction —
   same connection, atomic with the advisory lock. Actor is set via `set_config` before the UPDATE.
   This requires `GRANT jarvis_auth_runtime TO jarvis_migration_owner` in bootstrap so the migration
   can `SET LOCAL ROLE jarvis_auth_runtime` to create the function as auth_runtime.

3. **`jarvis_worker_runtime` has `SELECT` on `users` (from `0001`).** No worker code currently
   references users in production paths. A self-row SELECT policy is added for consistency (prevents
   rogue future usage from bypassing RLS silently).

4. **`workspaces`, `workspace_memberships`, `admin_audit_events` do not have FORCE RLS.** The
   bootstrap hook's inserts into these tables work without an actor set — no change needed.

5. **`auth_verifications`**: Not in the spec's FORCE RLS scope (only the three tables). We REVOKE
   `jarvis_app_runtime`'s grants on it and grant to `jarvis_auth_runtime`, but do NOT add FORCE RLS.

---

## Tasks

Each task = one green commit. `Co-Authored-By: Claude Sonnet 4.6`

---

### Task 1 — Bootstrap: add `jarvis_auth_runtime` role

**File:** `infra/postgres/bootstrap/0000_roles.sql`

- Idempotent `DO $$ BEGIN IF NOT EXISTS CREATE ROLE jarvis_auth_runtime LOGIN PASSWORD
  'auth_password'; ELSE ALTER ... WITH LOGIN PASSWORD 'auth_password'; END IF; END $$;`
- `ALTER ROLE jarvis_auth_runtime WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
  NOBYPASSRLS;`
- In the dynamic GRANT CONNECT block: add `jarvis_auth_runtime`.
- `GRANT jarvis_auth_runtime TO jarvis_migration_owner;` — allows the migration to
  `SET LOCAL ROLE jarvis_auth_runtime` so the SECURITY DEFINER helper function is owned by
  auth_runtime (not migration_owner which would have no rows under FORCE RLS).

**Test:** Running `pnpm db:up && JARVIS_PGDATABASE=jarvis_p52 pnpm db:migrate` succeeds (bootstrap
re-runs are idempotent). `tests/integration/foundation.test.ts` exercises this path.

---

### Task 2 — db/urls: add `auth` URL

**File:** `packages/db/src/urls.ts`

- Extend `JarvisDatabaseUrls` interface with `readonly auth: string;`
- Return `env.JARVIS_AUTH_DATABASE_URL ?? \`postgres://jarvis_auth_runtime:auth_password@${host}:${port}/${database}\``

**Test:** Unit/compile-time — TypeScript will error if consumers omit the field. Integration tests
use this URL implicitly when auth runtime is constructed without an explicit connectionString.

---

### Task 3 — Migration 0045: RLS policies + auth role grants + helper function

**File:** `infra/postgres/migrations/0045_auth_secret_rls.sql` (new)

Contents (in order, idempotent DROP POLICY IF EXISTS / CREATE POLICY shape from `0009`):

```
1. Idempotent role creation guard (DO block, IF NOT EXISTS, same as 0000 pattern)
2. GRANT USAGE ON SCHEMA app TO jarvis_auth_runtime
3. GRANT SELECT, INSERT, UPDATE, DELETE ON auth_accounts, better_auth_sessions,
   auth_verifications, users TO jarvis_auth_runtime
4. REVOKE SELECT, INSERT, UPDATE, DELETE ON auth_accounts, better_auth_sessions,
   auth_verifications FROM jarvis_app_runtime
   (keep users grants for app_runtime — needed for self-row operations)
5. ALTER TABLE app.auth_accounts ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;
6. ALTER TABLE app.better_auth_sessions ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;
7. ALTER TABLE app.users ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;

Policies — auth_accounts (DROP IF EXISTS + CREATE):
  auth_accounts_auth_runtime: TO jarvis_auth_runtime USING (true) WITH CHECK (true)

Policies — better_auth_sessions:
  better_auth_sessions_auth_runtime: TO jarvis_auth_runtime USING (true) WITH CHECK (true)

Policies — users:
  users_auth_runtime:        TO jarvis_auth_runtime, FOR ALL, USING (true) WITH CHECK (true)
  users_app_runtime_select:  TO jarvis_app_runtime, FOR SELECT, USING (id = app.current_actor_user_id())
  users_app_runtime_insert:  TO jarvis_app_runtime, FOR INSERT, WITH CHECK (id = app.current_actor_user_id())
  users_app_runtime_update:  TO jarvis_app_runtime, FOR UPDATE,
                             USING (id = app.current_actor_user_id())
                             WITH CHECK (id = app.current_actor_user_id())
  users_worker_runtime:      TO jarvis_worker_runtime, FOR SELECT,
                             USING (id = app.current_actor_user_id())

SECURITY DEFINER helper function (owned by jarvis_auth_runtime via SET LOCAL ROLE):
  SET LOCAL ROLE jarvis_auth_runtime;
  CREATE OR REPLACE FUNCTION app.count_all_users()
    RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = app, pg_temp
    AS $$ SELECT count(*) FROM users $$;
  REVOKE EXECUTE ON FUNCTION app.count_all_users() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION app.count_all_users() TO jarvis_app_runtime;
  RESET ROLE;
```

**Test:** `JARVIS_PGDATABASE=jarvis_p52 pnpm db:migrate` green. `pnpm audit:release-hardening`
will drive this in later tasks.

---

### Task 4 — Fix `AuthSessionResolver` (remove redundant users join)

**File:** `packages/db/src/auth-session.ts`

- Remove `.innerJoin("app.users as users", "users.id", "sessions.user_id")` from the Kysely chain.
- The `user_id` FK has `ON DELETE CASCADE`, so if the user is deleted the session is deleted.
  The join was defensive-only; removing it eliminates the FORCE RLS blockage.

**Test:** `tests/integration/auth-settings.test.ts` exercises the legacy bearer path. Run suite to
confirm legacy sessions still resolve.

---

### Task 5 — Point better-auth pool at auth URL + fix bootstrap hook

**File:** `packages/auth/src/index.ts`

Changes:
1. `const pool = new Pool({ connectionString: options.connectionString ?? getJarvisDatabaseUrls(env).auth, ... })`
   (was `.app`)
2. Pass `pool` down to `bootstrapFirstJarvisUser` via `createBetterAuthOptions`.
   - Actually: `bootstrapFirstJarvisUser` needs `appDb` for the advisory lock + workspace inserts,
     and the count_all_users SECURITY DEFINER function is callable via `appDb`. So the function
     signature stays the same — just replace the direct `selectFrom("app.users").countAll()` call
     with `sql<{count: string}>\`SELECT app.count_all_users() AS count\`.execute(transaction)`.
3. Before the `updateTable("app.users")` call, set the actor GUC within the transaction:
   ```ts
   await sql`SELECT set_config('app.actor_user_id', ${user.id}, true)`.execute(transaction);
   ```
   This scopes the actor to the transaction only (`true` = local), satisfying the self-row UPDATE
   policy while the advisory lock prevents any other bootstrap from racing.

**Test:** `pnpm test:integration` (auth-settings suite): sign-up bootstraps first user as
instance admin and creates workspace. Second sign-up does NOT get admin or workspace. This is the
key functional regression guard.

---

### Task 6 — Extend release-hardening audit for auth tables + new role

**File:** `scripts/audit-release-hardening.ts`

Changes:
- Add `"jarvis_auth_runtime"` to `runtimeRoles` const and the role query.
- Add `authSecretTables = ["auth_accounts", "better_auth_sessions"] as const` — these must have
  `rlsEnabled && forceRls` AND `jarvis_app_runtime` must have `SELECT = false` (grant was revoked).
- Add `authOwnerTable = ["users"] as const` — must have `rlsEnabled && forceRls`; `jarvis_app_runtime`
  retains SELECT so that check is not applied, but RLS+FORCE must be confirmed.
- Extend `ReleaseHardeningAuditReport` with `authSecretTables` and `authOwnerTable` arrays
  (using a new `AuthTableAudit` shape that includes `appCanSelect`).
- `collectFailures` gains: missing auth role, auth role is superuser/bypassRls/canCreateDb/canCreateRole,
  auth_accounts/better_auth_sessions rlsEnabled=false, forceRls=false, or appCanSelect=true.
  users: rlsEnabled=false or forceRls=false.

**Test:** `pnpm audit:release-hardening` (runs the script with the migrated DB) passes.

---

### Task 7 — Extend integration test: assert RLS invariant

**File:** `tests/integration/release-hardening.test.ts`

Changes:
- Update the `audits runtime roles` test:
  - Expect `jarvis_auth_runtime` in `report.roles` with `bypassRls: false, isSuperuser: false,
    canCreateDb: false, canCreateRole: false`.
- Add a test `"auth tables have forced RLS and jarvis_app_runtime cannot read tokens"`:
  - `report.authSecretTables`: `auth_accounts` and `better_auth_sessions` have
    `rlsEnabled: true, forceRls: true, appCanSelect: false`.
  - `report.authOwnerTable`: `users` has `rlsEnabled: true, forceRls: true`.
  - `report.failures` remains `[]`.
- Optionally (belt-and-suspenders): use the bootstrap connection to verify a `jarvis_app_runtime`
  connection (no actor set) cannot SELECT from `auth_accounts`:
  ```ts
  const appClient = new Client({ connectionString: connectionStrings.app });
  await appClient.connect();
  const result = await appClient.query('SELECT * FROM app.auth_accounts');
  expect(result.rows).toHaveLength(0); // RLS filters all rows — no actor set
  await appClient.end();
  ```
  (The grant is revoked on auth_accounts entirely, so this would actually error with permission
  denied — expect `appClient.query(...)` to throw.)

**Test:** Full integration suite green.

---

### Task 8 — Dev env: expose `JARVIS_AUTH_DATABASE_URL`

**Files:**
- `infra/env.production.example`: add `JARVIS_AUTH_DATABASE_URL=postgres://jarvis_auth_runtime:<auth-role-password>@postgres:5432/jarv1s`
- `infra/docker-compose.yml`: add `JARVIS_AUTH_DATABASE_URL: postgres://jarvis_auth_runtime:auth_password@postgres:5432/jarv1s` to the `api` service (and migrate service if needed for any bootstrap).
- `docs/operations/dev-environment.md`: document the new role and URL.

**Test:** The `"documents production environment variables"` test in release-hardening.test.ts checks
`env.production.example` — update expected vars list to include `JARVIS_AUTH_DATABASE_URL=`.

---

### Task 9 — Full gate verification

```bash
export JARVIS_PGDATABASE=jarvis_p52
pnpm db:up
pnpm db:migrate
pnpm verify:foundation     > /tmp/verify-foundation.log 2>&1; echo "exit=$?"
pnpm test:integration      > /tmp/test-integration.log 2>&1; echo "exit=$?"
pnpm audit:release-hardening > /tmp/audit-hardening.log 2>&1; echo "exit=$?"
```

All three must exit 0. Real exit codes captured to files (per feedback memory — never pipe gate to
`tail`). Read summary + exit code explicitly.

---

## Exit criteria coverage

| Spec criterion | Task |
|---|---|
| 1. `auth_accounts`, `better_auth_sessions`, `users` have `relrowsecurity` + `relforcerowsecurity` | Task 3 (migration), Task 6 (audit checks) |
| 2. `jarvis_app_runtime` WITHOUT auth role cannot read `access_token`/`password` | Task 3 (REVOKE), Task 7 (integration test) |
| 3. better-auth sign-up/sign-in/session resolve still pass; legacy bearer path still resolves | Tasks 4, 5, 9 |
| 4. `pnpm audit:release-hardening` green with auth tables + `jarvis_auth_runtime` audited | Tasks 6, 7, 9 |
| 5. `pnpm verify:foundation` green | Task 9 |

---

## Hard invariants honored

- `jarvis_auth_runtime`: `NOBYPASSRLS` — goes through RLS with permissive policy, not BYPASSRLS.
- `app.count_all_users()` SECURITY DEFINER — owned by `jarvis_auth_runtime` which is `NOBYPASSRLS`.
  Superuser is NOT the definer. `REVOKE FROM PUBLIC`, `GRANT TO jarvis_app_runtime` only.
- Migration `0004` is untouched. All changes in new `0045` file.
- `AccessContext` shape unchanged; no new GUC fields.
- No secrets in plan, PR description, or test assertions.
