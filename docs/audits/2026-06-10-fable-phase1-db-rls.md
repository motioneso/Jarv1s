## Phase 1 — DB Foundation & RLS

**Model:** Sonnet 4.6 (Fable 5 unavailable — org model restriction)  
**Date:** 2026-06-10  
**Scope:** `infra/postgres/migrations/` (0001–0046), `packages/db/src/`, `packages/auth/src/index.ts`, four DB roles

---

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0  
- HIGH: 1  
- MED: 2  
- LOW: 2  
- INFO: 3  

---

### Findings

#### [HIGH] SettingsRepository bypasses DataContextDb invariant — raw Kysely, no actor GUC

**File:** `packages/settings/src/repository.ts:16,64`  
**Invariant violated:** "Repositories accept only a branded `DataContextDb` handle, never a root Kysely instance."  
**Detail:**  
`SettingsRepository` is constructed with `Kysely<JarvisDatabase>` and uses an internal type alias `SettingsDb = Kysely<JarvisDatabase> | Transaction<JarvisDatabase>`. It never accepts `DataContextDb`, never calls `assertDataContextDb`, and never has the actor GUC (`app.actor_user_id`) set before executing queries.

This affects every method: `listUsers`, `getUserById`, `listWorkspaces`, `listMembershipsForWorkspace`, `listResourceGrants`, `listAdminAuditEvents`, `listInstanceSettings`, and all write paths. The routes layer passes `dependencies.appDb` — the root Kysely connection — directly at construction time (`routes.ts:75`).

Currently safe because the tables queried (`app.users`, `app.workspaces`, `app.workspace_memberships`, `app.resource_grants`, `app.admin_audit_events`, `app.instance_settings`) have no RLS policies. However, this is a ticking clock: any future RLS policy added to these tables will be silently bypassed by all SettingsRepository queries. The `app.users` SELECT policy is currently `USING(true)` so admin list-all works — but the moment that's tightened (e.g., post-Phase 5), `requireAdmin` breaks silently.

A secondary consequence: SettingsRepository write paths (e.g., `createWorkspace`, `upsertWorkspaceMembership`) start their own internal `this.db.transaction()` — so they also skip the GUC-setting wrapper, meaning any RLS policy that inspects `app.current_actor_user_id()` on those tables would see NULL.

**Suggested fix:**  
Migrate `SettingsRepository` to accept `DataContextDb` like all other repositories, use `assertDataContextDb`, and move its instantiation inside a `withDataContext` block. For routes that currently pass a raw Kysely, add a `DataContextRunner` dependency and wrap route handlers in `withDataContext`. The admin bootstrap route (`/api/bootstrap/status`) is unauthenticated by design — it only calls `countUsers()` via the SECURITY DEFINER function and has no actor; make this an explicit exception with a documented "no-GUC" method rather than the entire repository.

---

#### [MED] Five app tables have no RLS — only application-layer admin checks protect them

**Files:** `infra/postgres/migrations/0001_app_schema.sql`, `0004_auth_workspaces_settings.sql`, `0005_admin_audit_events.sql`  
**Invariant violated:** DB-level defense-in-depth; "private by default."  
**Detail:**  
The following tables have `SELECT`, `INSERT`, `UPDATE`, or `DELETE` grants to `jarvis_app_runtime` but no `ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY` and no policies:

| Table | Grants to app_runtime | Sensitivity |
|---|---|---|
| `app.admin_audit_events` | SELECT, INSERT | Exposes all admin operations to any authenticated caller |
| `app.workspaces` | SELECT, INSERT, UPDATE | Cross-user workspace names/metadata visible |
| `app.workspace_memberships` | SELECT, INSERT, UPDATE, DELETE | Who belongs to which workspace — cross-user |
| `app.resource_grants` | SELECT, INSERT, UPDATE, DELETE | Cross-user resource access grants |
| `app.instance_settings` | SELECT, INSERT, UPDATE | Instance configuration visible to any app_runtime query |

`jarvis_worker_runtime` also has SELECT on `app.workspaces` and `app.instance_settings` without any RLS guard.

Currently all write paths go through admin-gated routes. But the DB has no second line of defense: any query (bug, misconfigured route, future code addition) running as `jarvis_app_runtime` against these tables returns or mutates all rows regardless of the acting user.

`app.instance_settings` is the widest risk: it is read by `repository.listInstanceSettings()` and `countUsers()`, and could hold sensitive configuration values if callers start storing them there.

**Suggested fix:**  
Add `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` and appropriate policies in a new migration. For admin-only tables (`admin_audit_events`, `workspaces`, `workspace_memberships`, `resource_grants`), a policy tied to `is_instance_admin` or an `app.current_actor_is_admin()` helper is correct. For `instance_settings`, a restrictive write policy + permissive read policy (it is instance-scoped, not per-user) is sufficient.

---

#### [MED] `users_app_runtime_update` self-row policy allows updating `is_instance_admin`

**File:** `infra/postgres/migrations/0045_auth_secret_rls.sql:96-102`  
**Invariant violated:** Privilege escalation — no admin private-data bypass.  
**Detail:**  
The current update policy:
```sql
CREATE POLICY users_app_runtime_update
  ON app.users FOR UPDATE TO jarvis_app_runtime
  USING (id = app.current_actor_user_id())
  WITH CHECK (id = app.current_actor_user_id());
```
This restricts which *row* can be updated (own row only) but places no restriction on *which columns*. Any `jarvis_app_runtime` actor can execute `UPDATE app.users SET is_instance_admin = true WHERE id = <self>`.

Currently mitigated by the absence of any API route that exposes a user self-update endpoint with free column selection — `bootstrapFirstJarvisUser` is the only code path that writes `is_instance_admin`, and it only sets it for the first user. However, the DB layer alone is not sufficient: if any future route permits a partial user update without column filtering, self-escalation to admin is possible.

Planned migration 0050 (Phase 5 / PR #93) is supposed to add an admin-scoped UPDATE policy. Verify that 0050 uses column-level grants (`GRANT UPDATE (name, email, ...) ON app.users TO jarvis_app_runtime`) rather than relying solely on policy predicates, since PostgreSQL RLS policies do not restrict which columns can be written — only column-level privileges do.

**Suggested fix:**  
Replace the blanket `GRANT SELECT, INSERT, UPDATE ON app.users TO jarvis_app_runtime` with column-scoped grants that exclude `is_instance_admin`. Or in migration 0050, use `GRANT UPDATE (name, email, email_verified, image, updated_at) ON app.users TO jarvis_app_runtime` and revoke the broad UPDATE grant.

---

#### [LOW] `app.has_resource_grant` is dead code with live EXECUTE grants

**File:** `infra/postgres/migrations/0002_app_rls.sql:43-93`  
**Invariant violated:** No stale concepts.  
**Detail:**  
`app.has_resource_grant(text, uuid, uuid)` was the original sharing helper. Migration 0018 replaced it with `app.has_share` in the probe RLS policy. Migration 0028 confirms the final probe policy uses only `app.has_share`. No current RLS policy or application code references `app.has_resource_grant`, but it still has `GRANT EXECUTE` to `jarvis_app_runtime` and `jarvis_worker_runtime`.

Dead SECURITY DEFINER functions are attack surface: if they can be called with arbitrary arguments and run as the function owner (migration_owner), an attacker who can execute arbitrary SQL as app_runtime could invoke them for unintended side effects. In this case the function is read-only and benign, but the principle applies.

**Suggested fix:**  
`DROP FUNCTION IF EXISTS app.has_resource_grant(text, uuid, uuid);` in a future cleanup migration.

---

#### [LOW] `app.users` has ENABLE RLS but not FORCE RLS — table owner bypasses

**File:** `infra/postgres/migrations/0045_auth_secret_rls.sql:48-51`  
**Invariant violated:** Partial — intentional exception, but worth tracking.  
**Detail:**  
The migration comment explains the rationale: `jarvis_migration_owner` (the table owner) must bypass RLS for SECURITY DEFINER functions that count/query users for admin checks. This is sound reasoning and correctly documented.

Risk: any future SECURITY DEFINER function owned by `jarvis_migration_owner` that queries `app.users` for user-profile data (not just a count or ID existence check) would bypass RLS and read all rows. This is a footgun for future contributors who add migration-owned SECURITY DEFINER helpers without realizing they bypass user-data RLS.

**Suggested fix:**  
Add a comment to the table DDL or a dedicated ADR note warning future migration authors that `SECURITY DEFINER` functions owned by `jarvis_migration_owner` bypass `app.users` RLS. Alternatively, explore converting `count_all_users()` to be owned by `jarvis_auth_runtime` (already done) and make future user-query helpers owned by `jarvis_auth_runtime` so they are fully RLS-constrained.

---

#### [INFO] No user status enforcement in `resolveRequestAccessContext` — expected pre-PR #93

**File:** `packages/auth/src/index.ts:208-231`  
**Detail:**  
Neither the session path (`auth.api.getSession`) nor the bearer token path (`app.resolve_auth_session`) checks whether the user's status is active. There is currently no `status` column on `app.users`.

Once PR #93 / Phase 5 adds the `status` field and the deactivation feature (migration 0050), both paths must be updated:
1. **Session path:** After `const session = ...`, fetch the user and assert `user.status === 'active'` before returning the AccessContext.
2. **Bearer path:** The `app.resolve_auth_session` SECURITY DEFINER function must join against `app.users` and filter `u.status = 'active'`, or the `AuthSessionResolver` must do a follow-up user status check.

Failing to update these paths means a deactivated user's existing sessions remain valid indefinitely — the deactivation feature would be cosmetic only.

---

#### [INFO] `jarvis_migration_owner` is permanently a member of `jarvis_auth_runtime`

**File:** `infra/postgres/bootstrap/0000_roles.sql:74`  
**Detail:**  
`GRANT jarvis_auth_runtime TO jarvis_migration_owner` was added to enable the OWNER TO transfer pattern in migrations 0045 and 0046. The migration comments note that `REVOKE` was considered but requires `ADMIN OPTION` (not included in the grant).

Risk is low: `jarvis_migration_owner` has `NOINHERIT`, so it does not automatically receive `jarvis_auth_runtime` privileges in normal session contexts. The migration role is only used for schema changes, not request handling. But in a hypothetical scenario where `jarvis_migration_owner` connects at runtime, `SET ROLE jarvis_auth_runtime` would succeed.

**Suggested fix:**  
Document this permanently in a comment in the bootstrap file. Consider whether the bootstrap can be restructured to use `ADMIN OPTION` so the membership can be revoked post-migration.

---

#### [INFO] `bootstrapFirstJarvisUser` uses raw Kysely transaction — intentional, correctly handled

**File:** `packages/auth/src/index.ts:233-307`  
**Detail:**  
This function accepts `Kysely<JarvisDatabase>` (the app pool), not `DataContextDb`. It manually sets the actor GUC via `set_config('app.actor_user_id', user.id, true)` within the transaction before the UPDATE. The pattern is correct: the GUC is set, the UPDATE is scoped to the actor's own row, and the advisory lock ensures first-user atomicity.

This is a necessary exception — the function is called from better-auth's `databaseHooks.user.create.after` hook, before any AccessContext exists. TypeScript's brand check on `DataContextDb` still prevents callers from accidentally passing this raw Kysely to other repositories. Worth documenting as an intentional exception in the codebase.

---

### Role audit

All four runtime roles explicitly declare `NOBYPASSRLS` in `infra/postgres/bootstrap/0000_roles.sql` (lines 29–59). `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOREPLICATION` are also set. ✓

No `BYPASSRLS` grant appears anywhere in the migration sequence or bootstrap scripts. ✓

`jarvis_auth_runtime` is correctly restricted to auth tables only, with no access to module data tables. ✓

`FORCE ROW LEVEL SECURITY` is applied to all four auth-secret tables (auth_accounts, better_auth_sessions, auth_sessions, auth_verifications). `ENABLE` (not FORCE) on users is intentional and documented. ✓
