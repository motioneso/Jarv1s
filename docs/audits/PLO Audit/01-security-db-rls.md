# DB-Level Security & RLS Audit

**Section:** A — DB-level Security & RLS
**Date:** 2026-06-10
**Auditor:** Subagent (claude-sonnet-4-6)
**Scope:** All Postgres migration files (`infra/postgres/migrations/`, `infra/postgres/bootstrap/`, `infra/postgres/grants/`), all `packages/*/sql/` directories, and supporting application code that touches these tables.

---

## Executive Summary

The auth-table hardening work in migrations 0045–0046 is solid. All product module tables (tasks, chat, email, calendar, briefings, connectors, AI, memory, notifications) carry ENABLE+FORCE RLS with correct owner-scoped or owner-or-share policies. No role has BYPASSRLS. Migration integrity checking is enforced by SHA-256 checksums. Module SQL is correctly isolated to owning module directories.

However, four tables in the `app` schema that underpin the entire access-control and configuration layer have **zero row-level security**: `workspace_memberships`, `resource_grants`, `workspaces`, and `instance_settings`. One more — `admin_audit_events` — has no RLS and accepts INSERT from all authenticated sessions. The pg-boss job queue schema exposes all job rows (including actor IDs) to both runtime roles with no restriction. One worker grant (`memory_chunks`, `memory_file_index`) was added in migration 0040 without corresponding policy entries, making the worker silently denied at runtime despite holding the GRANT.

---

## Findings

### [CRITICAL] workspace_memberships has no RLS — any user can read and modify all workspace memberships

- **File:** `infra/postgres/migrations/0001_app_schema.sql`, `infra/postgres/migrations/0004_auth_workspaces_settings.sql`
- **Category:** Security
- **Finding:** `app.workspace_memberships` has `SELECT, INSERT, UPDATE, DELETE` grants to `jarvis_app_runtime` with no `ENABLE ROW LEVEL SECURITY` or any RLS policy applied at any migration. Any authenticated user whose request runs as `jarvis_app_runtime` can `SELECT` all membership rows (cross-user membership enumeration), `INSERT` themselves into any workspace with any role, and `UPDATE` existing memberships to escalate their role.
- **Evidence:**
  ```sql
  -- 0001_app_schema.sql (no ENABLE RLS ever added)
  CREATE TABLE app.workspace_memberships (
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    role         text NOT NULL,
    ...
  );
  GRANT SELECT, INSERT, UPDATE, DELETE ON app.workspace_memberships TO jarvis_app_runtime;
  ```
  The settings repository (`packages/settings/src/repository.ts:105-115`) queries this table directly without any actor filter.
- **Impact:** Privilege escalation and full membership enumeration across all workspaces. An attacker who can make authenticated API calls (or who compromises app_runtime) can promote themselves to workspace owner on any workspace, read all membership structures, or delete memberships for other users.
- **Recommendation:** Add `ALTER TABLE app.workspace_memberships ENABLE ROW LEVEL SECURITY; ALTER TABLE app.workspace_memberships FORCE ROW LEVEL SECURITY;` in a new migration. Add policies: SELECT restricted to rows where `user_id = app.current_actor_user_id()` OR the actor is a member of the workspace (join through a SECURITY DEFINER function); INSERT/UPDATE/DELETE restricted to workspace owners only. Admin operations (settings routes) that need full access should use a SECURITY DEFINER function owned by `jarvis_auth_runtime` or `jarvis_migration_owner` rather than bypassing RLS.

---

### [CRITICAL] resource_grants has no RLS — any user can read all grants and insert grants for themselves

- **File:** `infra/postgres/migrations/0001_app_schema.sql`, `infra/postgres/migrations/0004_auth_workspaces_settings.sql`
- **Category:** Security
- **Finding:** `app.resource_grants` has full CRUD grants to `jarvis_app_runtime` with no RLS. `resource_grants` is the table that the `app.has_share()` SECURITY DEFINER function reads to determine cross-user access. An attacker can SELECT all grants (full information leak of every sharing relationship in the system), INSERT grants giving themselves view/contribute/manage access to any resource ID, or DELETE existing grants.
- **Evidence:**
  ```sql
  -- 0001_app_schema.sql (no ENABLE RLS ever added)
  CREATE TABLE app.resource_grants (
    resource_type    text NOT NULL,
    resource_id      text NOT NULL,
    grantee_user_id  uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    grant_level      text NOT NULL,
    granted_by_user_id uuid NOT NULL,
    ...
  );
  GRANT SELECT, INSERT, UPDATE, DELETE ON app.resource_grants TO jarvis_app_runtime;
  ```
  `app.has_share()` in migration 0017 reads `app.resource_grants` as a SECURITY DEFINER function owned by `jarvis_migration_owner` with an unrestricted policy `TO jarvis_migration_owner USING(true)`. Once an attacker inserts a row into `resource_grants`, `has_share()` will return true and all downstream module RLS SELECT policies will grant access.
- **Impact:** This is a complete bypass of the owner-or-share RLS model. Any authenticated user can escalate to read any shared resource (task, calendar event, email, briefing, chat thread) by inserting a row into resource_grants directly. The entire shareability model rests on the integrity of this table.
- **Recommendation:** ENABLE+FORCE RLS on `app.resource_grants`. Policy: INSERT restricted to `granted_by_user_id = app.current_actor_user_id()` (only resource owners can grant); SELECT restricted to `grantee_user_id = app.current_actor_user_id() OR granted_by_user_id = app.current_actor_user_id()`; UPDATE/DELETE only by `granted_by_user_id`. Because `app.has_share()` is SECURITY DEFINER (owned by `jarvis_migration_owner`), it will bypass ENABLE RLS on resource_grants — but add FORCE RLS as well to ensure even migration_owner sessions are protected outside of SECURITY DEFINER contexts.

---

### [CRITICAL] pg-boss job schema exposes all job rows to both runtime roles with no RLS

- **File:** `infra/postgres/grants/0001_pgboss_runtime_grants.sql`
- **Category:** Security
- **Finding:** Full CRUD on all tables in the `pgboss` schema is granted to both `jarvis_app_runtime` and `jarvis_worker_runtime` with no RLS applied to any pg-boss table. pg-boss job rows include `data` (payload JSON containing `actorUserId`, job kind, resource IDs) and metadata about all queued/completed/failed jobs for all users. Any authenticated request running as `jarvis_app_runtime` can SELECT all job rows from all users.
- **Evidence:**
  ```sql
  -- 0001_pgboss_runtime_grants.sql
  GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA pgboss
    TO jarvis_app_runtime, jarvis_worker_runtime;
  ```
  pg-boss manages its own schema and tables; the project cannot add RLS policies to pg-boss tables without forking or patching pg-boss internals.
- **Impact:** Cross-user job enumeration: any authenticated user can read the job queue and see all job metadata rows across users (actor IDs, queue names, command params, idempotency keys) — by the metadata-only-payload invariant, job payloads contain no private content. An attacker can also cancel, update, or insert jobs for other users. While job payloads are supposed to contain only metadata (per the hard invariant), the actor IDs and resource IDs themselves still leak inter-user relationships.
- **Recommendation:** Restrict `jarvis_app_runtime` to INSERT-only on pg-boss job submission tables and no direct SELECT on job output tables. All job reads for a user's own jobs should go through SECURITY DEFINER functions or a dedicated job-query API that filters by `actorUserId`. Alternatively, use a separate pg-boss database schema and pool that only `jarvis_worker_runtime` can connect to, with app_runtime only able to enqueue via a SECURITY DEFINER function. At minimum, document this as an accepted risk with a tracking issue, but this is a significant data leak surface given that jobs carry cross-user actor IDs.

---

### [HIGH] memory_chunks and memory_file_index worker grants have no corresponding RLS policies — worker DML silently affects zero rows (correctness/availability defect)

- **File:** `packages/memory/sql/0040_memory_chat_source.sql`, `packages/memory/sql/0030_memory_index.sql`, `packages/memory/sql/0032_memory_embedding_768.sql`
- **Category:** Security / Correctness
- **Finding:** Migration 0040 adds `GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_chunks TO jarvis_worker_runtime` and the same for `memory_file_index`. But the existing FORCE RLS policies on these tables (created in migrations 0030 and 0032) specify `TO jarvis_app_runtime` only. FORCE RLS means even a role with a table GRANT gets denied if no policy covers it. Result: `jarvis_worker_runtime` holds the GRANT but will be denied on every query by FORCE RLS. Worker recall embed jobs will silently fail or produce empty results at runtime.
- **Evidence:**
  ```sql
  -- 0030_memory_index.sql — original policy
  CREATE POLICY memory_chunks_app_runtime_all
    ON app.memory_chunks
    FOR ALL
    TO jarvis_app_runtime
    USING (owner_user_id = app.current_actor_user_id())
    WITH CHECK (owner_user_id = app.current_actor_user_id());

  -- 0040_memory_chat_source.sql — adds the grant but NO policy
  GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_chunks TO jarvis_worker_runtime;
  ```
  No migration adds a `TO jarvis_worker_runtime` policy on `memory_chunks` or `memory_file_index`.
- **Impact:** Two failure modes: (1) worker recall jobs fail silently with permission denied, producing no memory embeddings; (2) if PostgreSQL is lenient in some edge case, the missing policy could mean a future policy misread. This is a correctness bug that surfaces as a security gap — the intent was to allow worker access with owner-scoped restriction, but the policy was never written.
- **Recommendation:** Add a new migration that creates `TO jarvis_worker_runtime` policies on `memory_chunks` and `memory_file_index` matching the `TO jarvis_app_runtime` policies (owner-scoped: `owner_user_id = app.current_actor_user_id()`). Mirror the pattern used in `packages/ai/sql/0037_ai_worker_read_grants.sql` which correctly paired the GRANT with a policy update.

---

### [HIGH] instance_settings has no RLS — any authenticated user can read and write all instance settings

- **File:** `infra/postgres/migrations/0004_auth_workspaces_settings.sql`
- **Category:** Security
- **Finding:** `app.instance_settings` is granted `SELECT, INSERT, UPDATE` to `jarvis_app_runtime` with no RLS. This table stores instance-level configuration that is supposed to be admin-only (AI provider defaults, feature flags, etc.). Any authenticated user can read all instance settings and overwrite them.
- **Evidence:**
  ```sql
  -- 0004_auth_workspaces_settings.sql
  CREATE TABLE app.instance_settings (
    key               text PRIMARY KEY,
    value             jsonb NOT NULL,
    updated_by_user_id uuid REFERENCES app.users(id),
    ...
  );
  GRANT SELECT, INSERT, UPDATE ON app.instance_settings TO jarvis_app_runtime;
  ```
  The settings routes in `packages/settings/src/routes.ts` gate these endpoints with `requireAdmin()`, but there is no DB-level enforcement.
- **Impact:** Any authenticated user who can reach the database directly (e.g., via a SQL injection in another query, or if app_runtime credentials are compromised) can read all instance configuration and modify it, overriding AI provider settings, feature flags, or any other instance-level state.
- **Recommendation:** ENABLE+FORCE RLS on `app.instance_settings`. The `SELECT` policy should be unrestricted (all authenticated users may read public instance config, e.g., feature flags). The `INSERT/UPDATE` policy should restrict to `updated_by_user_id = app.current_actor_user_id()` combined with an `is_instance_admin()` check (same as the admin route guard). Alternatively, route all instance_settings writes through a SECURITY DEFINER function that enforces the admin check at the DB level.

---

### [HIGH] admin_audit_events has no RLS — any authenticated user can read all audit events and insert fabricated entries

- **File:** `infra/postgres/migrations/0005_admin_audit_events.sql`
- **Category:** Security
- **Finding:** `app.admin_audit_events` has `SELECT, INSERT` grants to `jarvis_app_runtime` with no RLS. The `SELECT` is supposed to be admin-only (the settings route is guarded by `requireAdmin()`), but there is no DB-level enforcement. Any `jarvis_app_runtime` session can also INSERT fabricated audit events with any actor_user_id, action, or metadata, polluting the audit trail.
- **Evidence:**
  ```sql
  -- 0005_admin_audit_events.sql
  CREATE TABLE app.admin_audit_events (
    id              uuid PRIMARY KEY,
    actor_user_id   uuid REFERENCES app.users(id) ON DELETE SET NULL,
    action          text NOT NULL,
    ...
  );
  GRANT SELECT, INSERT ON app.admin_audit_events TO jarvis_app_runtime;
  ```
  The `insertAuditEvent` private method in `packages/settings/src/repository.ts:481-505` accepts an arbitrary `actorUserId` parameter — it does not validate that `actorUserId` equals the current session's actor.
- **Impact:** Audit trail integrity is broken: any compromised app_runtime session can inject audit events attributing actions to other users. Any authenticated user can enumerate the full admin audit log (cross-user action history), which is a privacy leak in multi-user deployments.
- **Recommendation:** ENABLE+FORCE RLS on `app.admin_audit_events`. INSERT policy: `actor_user_id = app.current_actor_user_id()` (prevents cross-user audit event injection). SELECT policy: restrict to `is_instance_admin()` check, or expose only via a SECURITY DEFINER function. Also fix `insertAuditEvent` in the repository to always use the request's `actorUserId` from `AccessContext`, not an arbitrary parameter.

---

### [HIGH] workspaces has no RLS — any authenticated user can read all workspaces and create workspaces

- **File:** `infra/postgres/migrations/0004_auth_workspaces_settings.sql`
- **Category:** Security
- **Finding:** `app.workspaces` has `SELECT, INSERT, UPDATE` grants to `jarvis_app_runtime` with no RLS. Any authenticated user can enumerate all workspace names and their creator IDs, insert new workspaces (bypassing the createWorkspace business logic), or update workspace names.
- **Evidence:**
  ```sql
  -- 0004_auth_workspaces_settings.sql
  CREATE TABLE app.workspaces (
    id                  uuid PRIMARY KEY,
    name                text NOT NULL,
    created_by_user_id  uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    ...
  );
  GRANT SELECT, INSERT, UPDATE ON app.workspaces TO jarvis_app_runtime;
  ```
- **Impact:** Privacy leak (all workspace names visible to all users), workspace squatting (INSERT without going through the createWorkspace API which also sets the creator as owner), and workspace name hijacking (UPDATE).
- **Recommendation:** ENABLE+FORCE RLS on `app.workspaces`. SELECT: restrict to workspaces where the actor is a member (via `EXISTS (SELECT 1 FROM workspace_memberships WHERE workspace_id = id AND user_id = current_actor_user_id())`). INSERT: `created_by_user_id = app.current_actor_user_id()`. UPDATE: restrict to workspace owners.

---

### [HIGH] app.users SELECT policy allows app_runtime to read ALL user rows — over-broad for non-admin operations

- **File:** `infra/postgres/migrations/0045_auth_secret_rls.sql`
- **Category:** Security
- **Finding:** Migration 0045 adds `users_app_runtime_select` policy `FOR SELECT TO jarvis_app_runtime USING(true)` — any app_runtime session can read all user rows (id, email, display_name, created_at, etc.). The comment justifies this as "needed for admin routes, workspace membership checks, and any other app logic that requires reading other users' profiles." However, non-admin users do not need to enumerate all users.
- **Evidence:**
  ```sql
  -- 0045_auth_secret_rls.sql
  CREATE POLICY users_app_runtime_select
    ON app.users
    FOR SELECT
    TO jarvis_app_runtime
    USING (true);  -- unrestricted for app_runtime
  ```
- **Impact:** Any authenticated user can enumerate all registered user accounts (email addresses, display names, created_at timestamps). In a multi-user deployment this is a user enumeration vulnerability.
- **Recommendation:** Narrow the SELECT policy to: `id = app.current_actor_user_id()` for standard reads, and expose admin user listing only through `app.count_all_users()` style SECURITY DEFINER functions that perform the admin check at the DB level. The admin `listUsers()` call in the settings repository should route through such a function rather than a direct SELECT.

---

### [MEDIUM] connector admin-metadata policies target jarvis_migration_owner — unusual runtime use of migration role

- **File:** `packages/connectors/sql/0010_connector_admin_safe_metadata.sql`
- **Category:** Architecture
- **Finding:** Migration 0010 creates two RLS policies (`connector_definitions_admin_metadata_select`, `connector_accounts_admin_metadata_select`) `TO jarvis_migration_owner`. It also creates `app.list_connector_account_safe_metadata()` as a SECURITY DEFINER function but does not `ALTER FUNCTION ... OWNER TO jarvis_auth_runtime` — the function is owned by `jarvis_migration_owner` (default, since migration_owner creates it). At runtime, this function runs as `jarvis_migration_owner`, which bypasses ENABLE RLS on `app.users` (table owner is migration_owner). The RLS policy for migration_owner on connector tables also has no expiry — it persists for all time, meaning migration_owner connections at runtime can bypass the owner-only restriction on connector_accounts.
- **Evidence:**
  ```sql
  -- 0010_connector_admin_safe_metadata.sql
  CREATE POLICY connector_accounts_admin_metadata_select
    ON app.connector_accounts
    FOR SELECT
    TO jarvis_migration_owner
    USING (app.is_instance_admin(current_actor_user_id()));

  -- No ALTER FUNCTION ... OWNER TO ... follows
  CREATE OR REPLACE FUNCTION app.list_connector_account_safe_metadata() ...
    SECURITY DEFINER ...
  ```
- **Impact:** If the migration owner database connection is ever used at runtime (e.g., misconfigured pool), it bypasses the scoped connector_accounts RLS. The SECURITY DEFINER function owned by migration_owner can also read `app.users` without RLS restriction (ENABLE but not FORCE on users), potentially leaking user data in error paths.
- **Recommendation:** Transfer ownership of `app.list_connector_account_safe_metadata()` to `jarvis_auth_runtime` (the pattern established in 0045–0046). Add `GRANT CREATE ON SCHEMA app TO jarvis_auth_runtime; ALTER FUNCTION app.list_connector_account_safe_metadata() OWNER TO jarvis_auth_runtime; REVOKE CREATE ON SCHEMA app FROM jarvis_auth_runtime;` in a follow-up migration. Remove the `TO jarvis_migration_owner` runtime policies on connector tables; the SECURITY DEFINER function with its internal `is_instance_admin` check is sufficient access control.

---

### [MEDIUM] has_resource_grant() and has_resource_grant_level() are dead code with live EXECUTE grants

- **File:** `infra/postgres/migrations/0002_app_rls.sql`, `packages/tasks/sql/0003_tasks_module.sql`
- **Category:** Architecture / Quality
- **Finding:** `app.has_resource_grant()` (defined in 0002) and `app.has_resource_grant_level()` (defined in tasks 0003) have `GRANT EXECUTE TO jarvis_app_runtime` but are referenced by zero live RLS policies. All policies that previously used `has_resource_grant` were replaced by `has_share()` in migrations 0017–0019. These functions remain deployed with live execute grants but serve no purpose.
- **Evidence:**
  ```sql
  -- 0002_app_rls.sql
  GRANT EXECUTE ON FUNCTION app.has_resource_grant(text, text) TO jarvis_app_runtime;
  -- No live RLS policy uses this function after migration 0018
  ```
- **Impact:** Dead code with live grants increases the attack surface: any future SQL injection could call these functions to probe for resource_grants rows. The grant is unnecessary and should be removed to maintain least-privilege. The functions themselves read `app.resource_grants` (which currently has no RLS), amplifying the impact of the resource_grants finding above.
- **Recommendation:** In a new migration, `REVOKE EXECUTE ON FUNCTION app.has_resource_grant(...) FROM jarvis_app_runtime, jarvis_worker_runtime` and similarly for `has_resource_grant_level()`. Optionally DROP the functions if no code calls them.

---

### [MEDIUM] notifications insert policy prevents cross-user delivery from worker — architectural constraint with no documented escape hatch

- **File:** `packages/notifications/sql/0029_fix_notifications_insert_policy.sql`
- **Category:** Architecture
- **Finding:** The final notifications INSERT policy requires `recipient_user_id = app.current_actor_user_id()`. The worker runtime has no grants on the notifications tables at all. This means the worker cannot deliver a notification to a user (e.g., "your briefing is ready", "sync complete"). The fix for migration 0024's regression (0029) re-introduced a self-insert restriction that makes cross-user worker notifications impossible without a SECURITY DEFINER function.
- **Evidence:**
  ```sql
  -- 0029_fix_notifications_insert_policy.sql
  CREATE POLICY notifications_insert
    ON app.notifications
    FOR INSERT
    TO jarvis_app_runtime
    WITH CHECK (
      recipient_user_id = app.current_actor_user_id()
      AND actor_user_id = app.current_actor_user_id()
    );
  -- jarvis_worker_runtime: no GRANT, no policy
  ```
- **Impact:** Any feature that needs to notify a user about a background job result (briefing completion, memory indexing, connector sync) cannot do so through the DB layer. This is either a functional gap if such notifications are planned, or a restriction that should be explicitly documented and enforced architecturally.
- **Recommendation:** Define the intended notification delivery path. If cross-user notifications from the worker are needed, create `app.deliver_notification(recipient_id uuid, ...)` as a SECURITY DEFINER function owned by `jarvis_auth_runtime` that performs the INSERT with `USING(true)`, and grant EXECUTE to `jarvis_worker_runtime`. This preserves the "no direct cross-user table writes" invariant while enabling the legitimate worker→user notification path.

---

### [LOW] app.current_workspace_id() and app.is_workspace_member() are dropped but were referenced in old policies — confirm no stale references

- **File:** `infra/postgres/migrations/0028_workspace_teardown.sql`
- **Category:** Quality
- **Finding:** Migration 0028 drops `app.is_workspace_member()` and `app.current_workspace_id()` functions. These were used in RLS policies that were also dropped in 0028. The teardown migration drops the functions after dropping the policies that reference them, which is correct. However, if any in-application TypeScript code still calls `app.current_workspace_id()` (which was previously settable via `SET LOCAL app.workspace_id`), those calls will fail at runtime with a function-not-found error.
- **Evidence:**
  ```sql
  -- 0028_workspace_teardown.sql
  DROP FUNCTION IF EXISTS app.current_workspace_id();
  DROP FUNCTION IF EXISTS app.is_workspace_member(uuid, uuid);
  ```
- **Impact:** Low — the functions are dropped, so they cannot be misused. Risk is only if application code references them (runtime error rather than security issue).
- **Recommendation:** Grep application source for `current_workspace_id` and `is_workspace_member` to confirm no TypeScript code calls them. Verify the `workspaceId` field is fully absent from `AccessContext` across all packages (confirmed removed per CLAUDE.md invariant, but worth a final grep).

---

### [LOW] chat_user_memory_settings has no worker_runtime grant — latent trap if recall path changes

- **File:** `packages/chat/sql/0042_chat_memory_settings.sql`
- **Category:** Architecture
- **Finding:** `app.chat_user_memory_settings` has ENABLE+FORCE RLS with all four CRUD policies, but `jarvis_worker_runtime` has no GRANT on this table. The current recall flow runs on `jarvis_app_runtime` (RecallService in `packages/chat/src/recall-port.ts` uses `withDataContext` as app_runtime), so this is not a current bug. However, if recall is ever moved to a worker job (a natural optimization), the worker will be silently denied on every settings read.
- **Evidence:**
  ```sql
  -- 0042_chat_memory_settings.sql
  GRANT SELECT, INSERT, UPDATE, DELETE ON app.chat_user_memory_settings TO jarvis_app_runtime;
  -- No GRANT TO jarvis_worker_runtime
  ```
- **Impact:** Silent denial if recall is refactored to a worker path — the RLS denial returns no rows rather than an error, causing recall to silently use default settings instead of the user's configured settings.
- **Recommendation:** Add a comment in the migration and/or a `TODO` in `recall-port.ts` noting this constraint. If recall is ever moved to a worker job, add a `TO jarvis_worker_runtime` policy in the same migration that changes the execution context.

---

### [INFO] All four roles confirmed NOBYPASSRLS — hard invariant upheld

- **File:** `infra/postgres/bootstrap/0000_roles.sql`
- **Category:** Security
- **Finding:** All four roles (`jarvis_migration_owner`, `jarvis_app_runtime`, `jarvis_worker_runtime`, `jarvis_auth_runtime`) are explicitly set `NOBYPASSRLS`. This is verified by `ALTER ROLE ... WITH ... NOBYPASSRLS` for each role. No role created in any migration has BYPASSRLS. The hard invariant "No BYPASSRLS on runtime app or worker roles" is upheld.
- **Recommendation:** Add a migration-time or CI check that greps for `BYPASSRLS` (without `NO`) across all SQL files to catch future regressions.

---

### [INFO] Migration checksum integrity is enforced — never-edit invariant is mechanically enforced

- **File:** `packages/db/src/migrations/sql-runner.ts`
- **Category:** Architecture
- **Finding:** The migration runner stores SHA-256 checksums of applied migration files and throws `Error: Migration file ... has been modified` if any applied file is subsequently changed. This mechanically enforces the "never edit applied migrations" hard invariant. The sort order is lexicographic by filename prefix (numbers padded to ensure correct ordering).
- **Recommendation:** None. This is correctly implemented. Confirm the checksum is computed over the full file content (not just a header) — the current implementation uses `crypto.createHash('sha256').update(content).digest('hex')` which is correct.

---

### [INFO] Module SQL isolation is maintained — no module SQL found in infra/postgres/migrations/

- **File:** All `packages/*/sql/` directories
- **Category:** Architecture
- **Finding:** All module-specific SQL (tasks, chat, email, calendar, briefings, connectors, AI, memory, notifications, structured-state) lives exclusively in the respective module's `sql/` directory. No module schema definitions or policies were found in `infra/postgres/migrations/`. The migration orchestration in `scripts/migrate.ts` runs app migrations first, then each module separately.
- **Recommendation:** None. This isolation is correctly maintained.

---

### [INFO] SECURITY DEFINER function ownership pattern is consistent (0045–0046) but inconsistent in earlier migrations

- **File:** `packages/connectors/sql/0010_connector_admin_safe_metadata.sql`, `infra/postgres/migrations/0017_shares.sql`, `infra/postgres/migrations/0045_auth_secret_rls.sql`, `infra/postgres/migrations/0046_auth_sessions_rls.sql`
- **Category:** Architecture
- **Finding:** Migrations 0045 and 0046 establish a clear pattern for SECURITY DEFINER functions: create as migration_owner, temporarily grant CREATE to the intended owner role, ALTER FUNCTION ... OWNER TO, revoke CREATE, then SET LOCAL ROLE to revoke PUBLIC execute and grant to specific roles. Migration 0017 (`app.has_share()`) and 0010 (`app.list_connector_account_safe_metadata()`) predate this pattern and use different ownership strategies. `has_share()` is owned by `jarvis_migration_owner` with a permanent `TO jarvis_migration_owner` RLS policy. `list_connector_account_safe_metadata()` is owned by `jarvis_migration_owner` with no ownership transfer.
- **Recommendation:** Standardize all SECURITY DEFINER functions to the 0045–0046 pattern (owned by `jarvis_auth_runtime`, execute-granted to specific roles, revoked from PUBLIC). Create a follow-up migration to re-own `has_share()` and `list_connector_account_safe_metadata()`.

---

## Coverage Map

| Table | RLS Enabled | FORCE | Policy Complete | Notes |
|-------|-------------|-------|-----------------|-------|
| app.users | ENABLE only | No | Partial (SELECT all for app_runtime) | Intentional; migration_owner bypasses for SECURITY DEFINER |
| app.auth_accounts | ENABLE | FORCE | Yes (auth_runtime only) | |
| app.better_auth_sessions | ENABLE | FORCE | Yes (auth_runtime only) | |
| app.auth_sessions | ENABLE | FORCE | Yes (auth_runtime only) | |
| app.auth_verifications | ENABLE | FORCE | Yes (auth_runtime only) | |
| app.workspace_memberships | **NONE** | **NONE** | **NONE** | **CRITICAL** |
| app.resource_grants | **NONE** | **NONE** | **NONE** | **CRITICAL** |
| app.workspaces | **NONE** | **NONE** | **NONE** | **HIGH** |
| app.instance_settings | **NONE** | **NONE** | **NONE** | **HIGH** |
| app.admin_audit_events | **NONE** | **NONE** | **NONE** | **HIGH** |
| app.rls_probe_items | ENABLE | FORCE | Yes | |
| app.shares | ENABLE | FORCE | Yes | |
| app.tasks | ENABLE | FORCE | Yes | owner-or-share |
| app.task_activity | ENABLE | FORCE | Yes | owner-only |
| app.task_lists | ENABLE | FORCE | Yes | owner-only |
| app.task_tags | ENABLE | FORCE | Yes | owner-only |
| app.task_tag_assignments | ENABLE | FORCE | Yes | owner-only |
| app.task_preferences | ENABLE | FORCE | Yes | owner-only |
| app.notifications | ENABLE | FORCE | Partial | Worker cannot deliver cross-user |
| app.notification_reads | ENABLE | FORCE | Yes | owner-only |
| app.connector_definitions | ENABLE | FORCE | Yes | public+admin metadata |
| app.connector_accounts | ENABLE | FORCE | Yes | owner-only |
| app.connector_oauth_pending | ENABLE | FORCE | Yes | owner-only |
| app.ai_provider_configs | ENABLE | FORCE | Yes | owner-only + worker SELECT |
| app.ai_configured_models | ENABLE | FORCE | Yes | owner-only + worker SELECT |
| app.briefing_definitions | ENABLE | FORCE | Yes | owner-or-share |
| app.briefing_runs | ENABLE | FORCE | Yes | owner-only |
| app.calendar_events | ENABLE | FORCE | Yes | owner-or-share |
| app.email_messages | ENABLE | FORCE | Yes | owner-or-share |
| app.chat_threads | ENABLE | FORCE | Yes | owner-or-share |
| app.chat_messages | ENABLE | FORCE | Yes | parent-child via has_share |
| app.chat_user_memory_settings | ENABLE | FORCE | Yes | owner-only (app_runtime only) |
| app.memory_chunks | ENABLE | FORCE | **Incomplete** | Worker GRANT in 0040, no worker policy — **CRITICAL** |
| app.memory_file_index | ENABLE | FORCE | **Incomplete** | Worker GRANT in 0040, no worker policy — **CRITICAL** |
| app.memory_links | ENABLE | FORCE | Yes | owner-only |
| app.chat_memory_facts | ENABLE | FORCE | Yes | owner-only, both runtimes |
| app.commitments | ENABLE | FORCE | Yes | owner-or-share |
| app.entities | ENABLE | FORCE | Yes | owner-or-share |
| app.preferences | ENABLE | FORCE | Yes | owner-only |
| pgboss.* | **NONE** | **NONE** | **NONE** | **CRITICAL** — pg-boss manages its own schema |

---

## Hard Invariant Compliance

| Invariant | Status | Notes |
|-----------|--------|-------|
| No admin private-data bypass / no BYPASSRLS on runtime roles | PASS | All 4 roles NOBYPASSRLS |
| Private by default — owner-only unless explicitly shared | FAIL | resource_grants, workspace_memberships, workspaces, instance_settings, admin_audit_events have no RLS |
| DataContextDb only — never root Kysely | Not assessed in this section | |
| AccessContext shape — actorUserId + requestId only | Not assessed in this section | |
| Secrets never escape | PASS (auth tables) | auth_accounts, better_auth_sessions, auth_sessions locked to jarvis_auth_runtime |
| Metadata-only job payloads | Cannot verify at DB level | pg-boss has no RLS; payload content policy is app-level only |
| Provider-agnostic AI | Not assessed in this section | |
| Spec before build | Not assessed in this section | |
| Module isolation | PASS | Module SQL in module sql/ dirs only |
| pgvector image | Not assessed in this section | |
| Never edit applied migrations | PASS | SHA-256 checksum enforcement in sql-runner.ts |
