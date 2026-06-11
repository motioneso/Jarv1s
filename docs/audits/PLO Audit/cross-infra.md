# Infrastructure & Migrations Audit
**Scope:** `infra/postgres/bootstrap/`, `infra/postgres/migrations/`, `infra/postgres/grants/`  
**Date:** 2026-06-10  
**Reviewer:** Subagent (PLO Audit pass)

---

## Summary Table

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 5 |
| MEDIUM | 5 |
| LOW | 4 |
| INFO | 4 |

---

## Findings

### [CRITICAL] Worker runtime has grants but no RLS policies on three memory tables

- **File:** `packages/memory/sql/0040_memory_chat_source.sql`; policies in `packages/memory/sql/0030_memory_index.sql` and `packages/memory/sql/0032_memory_embedding_768.sql`
- **Category:** Security / Architecture
- **Finding:** Migration `0040` grants `jarvis_worker_runtime` `SELECT, INSERT, UPDATE, DELETE` on `app.memory_chunks`, `app.memory_file_index`, and `SELECT` on `app.memory_links`. All three tables have `FORCE ROW LEVEL SECURITY`. Their existing policies (`0030`, `0032`) specify `TO jarvis_app_runtime` only. PostgreSQL FORCE RLS means a role with no matching policy sees **zero rows** and INSERT/UPDATE/DELETE are **silently blocked** — it is not an error, it is invisible data loss.
- **Evidence:**
  ```sql
  -- 0040 grants:
  GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_chunks TO jarvis_worker_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_file_index TO jarvis_worker_runtime;
  GRANT SELECT ON app.memory_links TO jarvis_worker_runtime;

  -- 0030 policies (all omit jarvis_worker_runtime):
  CREATE POLICY memory_chunks_select ON app.memory_chunks
    FOR SELECT TO jarvis_app_runtime
    USING (owner_user_id = app.current_actor_user_id());
  ```
- **Impact:** The recall-embed pg-boss worker job runs as `jarvis_worker_runtime`. It will read zero rows from `memory_chunks` and `memory_file_index`, write zero rows, and do so silently. Memory recall is completely non-functional for the worker path. This is the exact trap documented in `MEMORY.md` ("the worker previously had no grants on these tables — same trap as chat pre-#17/#36") but the fix applied grants *without* the corresponding policy widening.
- **Recommendation:** Add a migration that drops and recreates the four policies (`_select`, `_insert`, `_update`, `_delete`) for `memory_chunks` and `memory_file_index`, and the three policies for `memory_links`, widening `TO jarvis_app_runtime` to `TO jarvis_app_runtime, jarvis_worker_runtime`. Follow the exact pattern used in `0036_chat_worker_runtime_grants.sql`.

---

### [HIGH] Five tables with row-level data lack RLS entirely

- **File:** `infra/postgres/migrations/0004_auth_workspaces_settings.sql`, `infra/postgres/migrations/0005_admin_audit_events.sql`
- **Category:** Security
- **Finding:** Five tables in the `app` schema have `GRANT` permissions for `jarvis_app_runtime` but no `ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY` and no policies:
  - `app.admin_audit_events` — SELECT, INSERT granted to `jarvis_app_runtime`
  - `app.resource_grants` — SELECT, INSERT, UPDATE, DELETE granted to `jarvis_app_runtime`
  - `app.workspace_memberships` — SELECT, INSERT, UPDATE, DELETE granted to `jarvis_app_runtime`
  - `app.workspaces` — SELECT, INSERT, UPDATE granted to `jarvis_app_runtime`
  - `app.instance_settings` — SELECT, INSERT, UPDATE granted to `jarvis_app_runtime`
- **Evidence:**
  ```sql
  -- 0004: no ENABLE/FORCE RLS on these tables
  GRANT SELECT, INSERT, UPDATE
    ON app.workspaces, app.workspace_memberships, app.resource_grants, app.instance_settings
    TO jarvis_app_runtime;
  -- 0005: no ENABLE/FORCE RLS on admin_audit_events
  GRANT SELECT, INSERT ON app.admin_audit_events TO jarvis_app_runtime;
  ```
- **Impact:** Any application query running as `jarvis_app_runtime` can `SELECT` all rows from these tables regardless of the authenticated user. `resource_grants` lists all sharing relationships in the system. `admin_audit_events` exposes all admin actions. `workspace_memberships` exposes user/workspace relationships. The only protection is application-layer gating (`requireAdmin`), which is a single layer of defence for highly sensitive tables. Per the project's "DB-level defense-in-depth" principle this is unacceptable.
- **Recommendation:** Enable and FORCE RLS on all five tables, then add per-role permissive policies:
  - `admin_audit_events`: SELECT scoped to `is_instance_admin`, INSERT scoped to `actor_user_id = current_actor_user_id()`.
  - `resource_grants`, `workspace_memberships`, `workspaces`: admin-read-all via `is_instance_admin`; owner/member scoped reads for runtime.
  - `instance_settings`: admin-write via `is_instance_admin`; read-all for any authenticated user is acceptable.

---

### [INFO] `app.current_workspace_id()` was cleanly dropped in migration 0028 — not in live schema

- **File:** `infra/postgres/migrations/0002_app_rls.sql`, `infra/postgres/migrations/0028_workspace_teardown.sql`
- **Category:** Architecture / Code quality
- **Finding:** `app.current_workspace_id()` was created in `0002_app_rls.sql` and is `DROP`ped in `0028_workspace_teardown.sql`. But `app.workspace_id` GUC reading is still present in `0002`. More critically: the function `app.is_workspace_member(uuid, uuid)` was created in `0002` and dropped in `0028`, but `0028` does NOT clean up the `app.current_workspace_id` GUC *usage* path — it only drops the function. The GUC `app.workspace_id` can still be set on a session, though no code now consults it. This is a consistency signal: the CLAUDE.md invariant "workspaceId permanently removed" is not fully enforced at the DB layer.
- **Evidence:**
  ```sql
  -- 0028 drops both functions, but app.workspace_id GUC remains settable:
  DROP FUNCTION IF EXISTS app.is_workspace_member(uuid, uuid);
  DROP FUNCTION IF EXISTS app.current_workspace_id();
  ```
- **Impact:** Dead schema surface area. If `app.workspace_id` is ever accidentally set (legacy code path), it is silently ignored — no error, no audit. Minimal security risk but violates the "remove dead vocabulary" standard.
- **Recommendation:** The drop in `0028` is correct. Document in a comment that `app.workspace_id` GUC is intentionally abandoned (not revoked — GUC revocation is not possible at DB level). Ensure no application code still sets this GUC.

---

### [HIGH] `app.has_resource_grant_level()` is dead schema after migration `0019`

- **File:** `packages/tasks/sql/0003_tasks_module.sql`
- **Category:** Architecture / Code quality
- **Finding:** `app.has_resource_grant_level(text, uuid, uuid, text[])` was created in `0003` and granted to both runtime roles. Migration `0019` replaced the `tasks_update` policy with one using `app.has_share()` instead. The function is now uncalled by any RLS policy or application code. It remains deployed in the schema indefinitely.
- **Evidence:**
  ```sql
  -- 0003: creates the function
  CREATE OR REPLACE FUNCTION app.has_resource_grant_level(...) RETURNS boolean ...
  -- 0019: replacement policy does NOT use it:
  CREATE POLICY tasks_update ON app.tasks ...
    USING (owner_user_id = ... OR app.has_share('task', id, 'manage'))
  ```
- **Impact:** Dead schema object, increases cognitive overhead of security review, and represents a surface for future confusion (someone might re-wire a policy to use it). Minor security consideration: the function bypasses RLS via `SECURITY DEFINER`, so its existence is a non-trivial attack surface if combined with a SQL injection in input parameters.
- **Recommendation:** Add a migration that `DROP FUNCTION IF EXISTS app.has_resource_grant_level(text, uuid, uuid, text[])`.

---

### [HIGH] Bootstrap runs without transactions — partial failure leaves DB inconsistent

- **File:** `packages/db/src/migrations/sql-runner.ts:98-116` (`runSqlFiles`); `infra/postgres/bootstrap/0000_roles.sql`; `infra/postgres/grants/0001_pgboss_runtime_grants.sql`
- **Category:** Architecture / Error handling
- **Finding:** `runSqlFiles()` executes SQL files one statement at a time with no transaction wrapping. Bootstrap (`0000_roles.sql`) and grants (`0001_pgboss_runtime_grants.sql`) are run via this path. If any statement fails after earlier ones succeed, the DB is left in a partially-applied state. There is no retry logic and no explicit idempotency guard for the grant file.
- **Evidence:**
  ```typescript
  // sql-runner.ts:98-116: no BEGIN/COMMIT
  for (const fileName of sqlFiles) {
    const sql = await readFile(join(directory, fileName), "utf8");
    await client.query(sql);  // no transaction
    executed.push(fileName);
  }
  ```
- **Impact:** In practice this is low risk for local dev (bootstrap failures are obvious). For production/CI, if `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC` succeeds but a subsequent `GRANT` fails, the runtime roles lose function access without any automatic recovery. The grants file re-runs on every `pnpm db:migrate` so recovery is one re-run, but there is no atomicity guarantee.
- **Note:** `client.query(sql)` sends each SQL file as a single query string to PostgreSQL via the simple query protocol, so all statements within one file run inside one implicit transaction. The real inconsistency window is across files in the loop, not within a single file.
- **Recommendation:** Wrap `runSqlFiles` in a transaction per-file (matching the migration runner pattern), or at minimum document that each `.sql` file in `grants/` must be fully idempotent and safe to partially re-apply.

---

### [HIGH] `connector_oauth_pending` has no index on `provider_id` FK column

- **File:** `packages/connectors/sql/0044_google_unified_connection.sql:39-44`
- **Category:** Architecture
- **Finding:** `app.connector_oauth_pending.provider_id` is a FK referencing `app.connector_definitions(provider_id)`. The only index on this table is `connector_oauth_pending_owner_idx ON (owner_user_id)`. The `UNIQUE (owner_user_id, provider_id)` constraint creates an index leading with `owner_user_id`. A cascade or FK enforcement scan from `connector_definitions → connector_oauth_pending` cannot use either of these indexes.
- **Evidence:**
  ```sql
  CREATE TABLE IF NOT EXISTS app.connector_oauth_pending (
    provider_id text NOT NULL REFERENCES app.connector_definitions(provider_id),
    ...
    UNIQUE (owner_user_id, provider_id)  -- leading col is owner_user_id, not provider_id
  );
  CREATE INDEX IF NOT EXISTS connector_oauth_pending_owner_idx
    ON app.connector_oauth_pending(owner_user_id);
  ```
- **Impact:** Low frequency (connector definitions are rarely deleted), but when they are, PostgreSQL must do a sequential scan of `connector_oauth_pending` for each row deleted from `connector_definitions`. With many users this causes lock contention and slow deletes.
- **Recommendation:** Add `CREATE INDEX IF NOT EXISTS connector_oauth_pending_provider_id_idx ON app.connector_oauth_pending(provider_id);`.

---

### [MEDIUM] `app.task_tag_assignments` has no index on the `tag_id` FK column

- **File:** `packages/tasks/sql/0039_tasks_foundation.sql:16-21`
- **Category:** Architecture
- **Finding:** `app.task_tag_assignments` has `PRIMARY KEY (task_id, tag_id)`. Cascading deletes triggered by removing a `task_tag` row need to find all assignments by `tag_id`. The PK index leads with `task_id` and cannot support `tag_id`-only lookups efficiently.
- **Evidence:**
  ```sql
  CREATE TABLE IF NOT EXISTS app.task_tag_assignments (
    task_id uuid NOT NULL REFERENCES app.tasks(id) ON DELETE CASCADE,
    tag_id  uuid NOT NULL REFERENCES app.task_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)  -- index unusable for tag_id-only lookup
  );
  ```
- **Impact:** As tag counts and assignment rows grow, `DELETE FROM app.task_tags WHERE id = $1` will cause a sequential scan of `task_tag_assignments`, taking a lock on the entire table.
- **Recommendation:** Add `CREATE INDEX IF NOT EXISTS task_tag_assignments_tag_id_idx ON app.task_tag_assignments(tag_id);`.

---

### [MEDIUM] Migration numbering has documented gaps at `0006` and `0007`

- **File:** `infra/postgres/migrations/0027_notes_teardown.sql:4`; migration sequence
- **Category:** Architecture / Code quality
- **Finding:** The migration sequence jumps from `0005` to `0008`. Numbers `0006` and `0007` correspond to the now-deleted `packages/notes` module migrations. The teardown migration (`0027`) documents this: "packages/notes is removed from the module registry, so 0006/0007 are no longer discovered or applied on fresh databases." The files no longer exist anywhere in the repo.
- **Evidence:**
  ```
  Sequence: 0001 0002 0003 0004 0005 [gap 0006 0007] 0008 0009 ...
  ```
- **Impact:** On a **fresh** database these numbers are never applied — correct. On a **pre-teardown** database these were applied from the notes package and then `0027` drops the resulting tables. The runner's hash-check only fires for files that exist; missing files are silently skipped. No functional issue, but the gaps create confusion in migration archaeology.
- **Recommendation:** Add a comment block in `0027_notes_teardown.sql` explicitly documenting that `0006` and `0007` were the notes-module migrations and are intentionally absent from all new databases. Consider a no-op placeholder file `0006_notes_module_tombstone.sql` with only a comment to preserve the numbering archaeology.

---

### [MEDIUM] `chat_memory_facts` and `chat_user_memory_settings` policies omit `TO` clause

- **File:** `packages/memory/sql/0041_memory_facts.sql:29-44`; `packages/chat/sql/0042_chat_memory_settings.sql:17-27`
- **Category:** Architecture / Code quality
- **Finding:** All four policies on `app.chat_memory_facts` and all four policies on `app.chat_user_memory_settings` omit the `TO <role>` clause. PostgreSQL interprets a missing `TO` as `TO PUBLIC` — the policy applies to every role. This is functionally correct (both app and worker runtimes are granted access and the policy correctly filters by `owner_user_id`), but it departs from the project-wide convention of explicit `TO jarvis_app_runtime[, jarvis_worker_runtime]` bindings and obscures which roles are intended to access these tables.
- **Evidence:**
  ```sql
  CREATE POLICY chat_memory_facts_select ON app.chat_memory_facts
    FOR SELECT USING (owner_user_id = app.current_actor_user_id());
  -- No TO clause: applies to ALL roles including superuser/migration_owner
  ```
- **Impact:** The implicit `PUBLIC` binding means if a new runtime role is added in the future (e.g. a read-only analytics role), it would silently gain access to user memory facts without an explicit grant decision. Migration-owner also matches, which bypasses the intent of FORCE RLS separation.
- **Recommendation:** Add explicit `TO jarvis_app_runtime, jarvis_worker_runtime` to all eight policies in these two files via a new migration. Add a separate `TO jarvis_migration_owner` bypass policy if needed for future backfill migrations (following the `0039` pattern).

---

### [MEDIUM] `0032_memory_embedding_768.sql` uses `TRUNCATE` without `IF EXISTS` guard

- **File:** `packages/memory/sql/0032_memory_embedding_768.sql:9-10`
- **Category:** Architecture
- **Finding:** The migration unconditionally truncates `app.memory_chunks` and `app.memory_links` before altering the vector column dimension. There is no guard for the case where the table might not yet exist (e.g. if `0030` is somehow not applied first). More importantly, `TRUNCATE` does not fire `ON DELETE` triggers or respect cascades in the child-table direction.
- **Evidence:**
  ```sql
  TRUNCATE TABLE app.memory_chunks;  -- no CASCADE, no IF EXISTS
  TRUNCATE TABLE app.memory_links;
  ```
- **Impact:** If there were any FK referencing `memory_chunks.id` (there currently are none), the truncate would fail with a FK violation. The current schema has no such FK, so the actual risk is low. However, any future FK added to `memory_chunks` would make this migration non-idempotent on fresh re-application. The `TRUNCATE` is also not reversible inside a transaction if the migration runner rolls back on error.
- **Recommendation:** Add `CASCADE` to the truncate statements (`TRUNCATE TABLE app.memory_chunks CASCADE; TRUNCATE TABLE app.memory_links CASCADE;`) and document that this data is derived/rebuildable.

---

### [LOW] Docker Compose has stale volume entry for deleted `packages/notes`

- **File:** `infra/docker-compose.yml:19`
- **Category:** Code quality
- **Finding:** The `notes` package was deleted as part of migration `0027`. The Docker Compose file still mounts `/workspace/packages/notes/node_modules` as a volume.
- **Evidence:**
  ```yaml
  - /workspace/packages/notes/node_modules  # package deleted in Slice 1e
  ```
- **Impact:** Minor: the volume mount for a non-existent path is silently ignored by Docker, but it adds noise and will confuse anyone reading the compose file.
- **Recommendation:** Remove the stale volume entry from `docker-compose.yml`.

---

### [LOW] Bootstrap passwords are hardcoded in both bootstrap SQL and Docker Compose

- **File:** `infra/postgres/bootstrap/0000_roles.sql:4,10,16,22`; `infra/docker-compose.yml:51-54`
- **Category:** Security
- **Finding:** The bootstrap script unconditionally sets role passwords to literal strings (`'migration_password'`, `'app_password'`, `'worker_password'`, `'auth_password'`). The compose file echoes these in its `environment` section. The `ALTER ROLE ... WITH ... PASSWORD '...'` runs every time `pnpm db:migrate` is executed, resetting any out-of-band password change.
- **Evidence:**
  ```sql
  ALTER ROLE jarvis_migration_owner WITH LOGIN PASSWORD 'migration_password';
  ```
- **Impact:** For local development this is acceptable. For any non-local deployment (including LAN/staging), these well-known passwords are effectively public. The `bootstrap/` script is idempotent-by-design but will overwrite production passwords on every migrate run if not templated.
- **Recommendation:** Template the passwords via environment variables in the bootstrap script (e.g. `${JARVIS_MIGRATION_PASSWORD}`). For local dev, `.env` with default values maintains current ergonomics. This is tracked as an ops hardening item.

---

### [LOW] `task_status` enum retains `in_progress` value after data migration removes all uses

- **File:** `packages/tasks/sql/0003_tasks_module.sql:10`; `packages/tasks/sql/0039_tasks_foundation.sql`
- **Category:** Code quality
- **Finding:** Migration `0039` migrates all `in_progress` tasks to `todo` status (`UPDATE app.tasks SET status = 'todo' WHERE status = 'in_progress'`). The enum value `in_progress` was not removed from `app.task_status`. Removing an enum value in PostgreSQL requires a table rewrite and is non-trivial, but the value remains accessible and could be re-introduced by application code accidentally.
- **Evidence:**
  ```sql
  -- 0003:
  CREATE TYPE app.task_status AS ENUM ('todo', 'in_progress', 'done', 'archived');
  -- 0039 migrates but does not drop the value:
  UPDATE app.tasks SET status = 'todo' WHERE status = 'in_progress';
  ```
- **Impact:** Low. The value cannot be dropped without rewriting the column, but the backlog item should be tracked. If no application code generates `in_progress`, the risk is only confusion.
- **Recommendation:** Add a `CHECK` constraint or application-layer validation rejecting `in_progress` status writes. Optionally schedule a future migration that rewrites the column to drop the value.

---

### [LOW] `app.admin_audit_events` and `app.notifications` `id` columns lack `DEFAULT gen_random_uuid()`

- **File:** `infra/postgres/migrations/0005_admin_audit_events.sql:2`; `packages/notifications/sql/0008_notifications_module.sql:2`
- **Category:** Code quality
- **Finding:** These two tables define `id uuid PRIMARY KEY` without `DEFAULT gen_random_uuid()`, requiring callers to always supply an ID. All other tables in the schema that use UUID PKs either have the default or use application-generated IDs consistently.
- **Evidence:**
  ```sql
  CREATE TABLE IF NOT EXISTS app.admin_audit_events (
    id uuid PRIMARY KEY,  -- no DEFAULT
  ```
- **Impact:** Inconsistency risk: if a future caller inserts without supplying an ID, it receives a PostgreSQL error rather than silently getting a generated ID. The current callers do supply IDs, so there is no functional issue today.
- **Recommendation:** Add `DEFAULT gen_random_uuid()` to both columns for consistency and safety. This is a backwards-compatible `ALTER TABLE ... ALTER COLUMN id SET DEFAULT gen_random_uuid()`.

---

## INFO

### [INFO] `GRANT jarvis_auth_runtime TO jarvis_migration_owner` is permanent

- **File:** `infra/postgres/bootstrap/0000_roles.sql:74`
- **Finding:** The bootstrap grants `jarvis_auth_runtime` membership to `jarvis_migration_owner` to enable `ALTER FUNCTION ... OWNER TO jarvis_auth_runtime` in migrations `0045`/`0046`. The comment in `0045` acknowledges that revoking this requires `ADMIN OPTION` which was not granted. The membership is "inert at runtime" because `jarvis_migration_owner` has `NOINHERIT`. This is noted here for audit completeness — it is an accepted tradeoff documented in the migration.

---

### [INFO] `runSqlFiles` for bootstrap re-runs on every migrate call

- **File:** `scripts/migrate.ts:15`; `packages/db/src/migrations/sql-runner.ts:98`
- **Finding:** `runSqlFiles(urls.bootstrap, bootstrapDirectory)` runs unconditionally on every `pnpm db:migrate`. The bootstrap scripts are idempotent (role existence checks, GRANT is idempotent), so this is safe. However, the bootstrap connection uses the superuser URL (`urls.bootstrap`) which means any SQL injection in a future bootstrap file would run as superuser. This is an accepted design choice but worth documenting.

---

### [INFO] pgvector is installed at bootstrap, not in migrations — correct

- **File:** `infra/postgres/bootstrap/0001_extensions.sql`
- **Finding:** `CREATE EXTENSION IF NOT EXISTS vector;` runs as the bootstrap superuser before any migrations. No migration attempts to `CREATE EXTENSION vector` again. This is the correct pattern per the hard invariant "pgvector image" in CLAUDE.md.

---

### [INFO] Migration runner uses advisory lock for concurrency control

- **File:** `packages/db/src/migrations/sql-runner.ts:161-167`
- **Finding:** `pg_advisory_lock(hashtext('jarv1s:migrations'))` correctly serializes concurrent migration runs. The lock key is a session-level advisory lock that auto-releases on disconnect. The `finally` block explicitly calls `releaseMigrationLock`. This is a solid pattern.

---

## Cross-reference with Prior Audits

The findings in `2026-06-10-fable-phase1-db-rls.md` flagged `app.users` lacking FORCE RLS (H1) and `app.auth_sessions` bearing a bearer token (H3). Both were closed by migrations `0045` and `0046`. This review confirms those migrations are correctly structured. The worker-runtime RLS gap on memory tables (CRITICAL above) is a new gap created by `0040` in the same batch, following the pattern the prior audit specifically warned against.
