## Phase 1 — DB-level Security & RLS

**Scope:** `infra/postgres/{bootstrap,migrations,grants}/`, all `packages/*/sql/`, plus the SQL runner and migration orchestrator that enforce hash integrity (`packages/db/src/migrations/sql-runner.ts`, `scripts/migrate.ts`).

**Severity counts:** CRIT 0 · HIGH 2 · MED 3 · LOW 2 · INFO 5

---

#### [HIGH] `app.resource_grants` has full app-runtime DML but NO row-level security

**File:** `infra/postgres/migrations/0004_auth_workspaces_settings.sql:87` (grant) and `infra/postgres/migrations/0005_admin_audit_events.sql:20` (added DELETE); no `ENABLE ROW LEVEL SECURITY` for this table exists in any migration or module SQL.  
**Invariant violated / concern:** "No admin private-data bypass / private by default" + DB-level defense-in-depth. `resource_grants` is a cross-user authorization table — it records which user is granted access to which resource at which level. `jarvis_app_runtime` holds SELECT/INSERT/UPDATE (0004:86-88) and DELETE (0005:20) on it with no RLS and no policy, so a SQL-injection or logic flaw in any app-runtime code path can read or forge cross-user access grants for arbitrary users. The table is actively read/written by `packages/settings/src/repository.ts:262-329` (`listResourceGrants` returns ALL grants for ALL users with `selectAll()` and no owner filter; `upsertResourceGrant`/`deleteResourceGrant` are mediated only by app-layer checks), so the protection is purely conventional.  
**Detail:** Every other security-relevant table in the codebase is `ENABLE`+`FORCE ROW LEVEL SECURITY` (confirmed by diffing CREATE-TABLE vs ENABLE-RLS across all SQL — 39 created, this is one of 5 with no RLS). This table is the highest-value of the unprotected set because it directly governs who-can-see-what. It is not dead: `packages/db/src/types.ts:479` and the settings repository still reference it live, even though policy-level cross-user access has moved to `app.shares` / `app.has_share` (0017). The result is two parallel grant systems where one (`shares`) is RLS-enforced and the other (`resource_grants`) is RLS-naked.  
**Suggested fix:** Add a migration that `ENABLE`+`FORCE ROW LEVEL SECURITY` on `app.resource_grants` with policies scoped `TO jarvis_app_runtime`: SELECT/DELETE restricted to rows where `granted_by_user_id = app.current_actor_user_id()` (or grantee = actor), INSERT/UPDATE `WITH CHECK (granted_by_user_id = app.current_actor_user_id())`. Better still, given `shares`/`has_share` is now the canonical model, decide whether `resource_grants` should be retired entirely (migrate callers to `shares`, drop the table) rather than dual-maintained — see the LOW finding below.

---

#### [HIGH] `app.workspace_memberships` has full app-runtime DML (incl. DELETE) but NO row-level security

**File:** `infra/postgres/migrations/0004_auth_workspaces_settings.sql:87` (SELECT/INSERT/UPDATE) and `infra/postgres/migrations/0005_admin_audit_events.sql:20` (DELETE); no RLS anywhere.  
**Invariant violated / concern:** DB-level defense-in-depth / private-by-default. `workspace_memberships` is still a live table (read/written by `packages/auth/src/index.ts:282` and `packages/settings/src/repository.ts:97-235`, typed at `packages/db/src/types.ts:478`) and `app_runtime` holds full CRUD on it with no RLS backstop. Any app-runtime flaw can enumerate or mutate every user's membership rows.  
**Detail:** The 0028 workspace teardown (`infra/postgres/migrations/0028_workspace_teardown.sql`) removed workspace *columns* from resource tables and dropped the workspace helper *functions* (`is_workspace_member`, `current_workspace_id`), but it did NOT drop the standalone `workspaces` / `workspace_memberships` tables, and the TS layer still uses them. So they sit in a half-deprecated state: no longer part of the RLS access path, but still live and still unprotected. `AccessContext` no longer even carries `workspaceId` (removed Slice 1f), which makes the continued existence of these tables suspect.  
**Suggested fix:** Either (a) add RLS + scoped policies for `workspace_memberships` (`TO jarvis_app_runtime`, rows visible/mutable only for the actor's own memberships), or preferably (b) complete the teardown — if workspaces are truly retired post-0028, migrate the remaining `auth`/`settings` callers off these tables and drop `workspaces` + `workspace_memberships` in a new migration. Do not leave a live, RLS-free authz table indefinitely.

---

#### [MED] `app.instance_settings` has app+worker grants but NO row-level security

**File:** `infra/postgres/migrations/0004_auth_workspaces_settings.sql:87-92` (app_runtime SELECT/INSERT/UPDATE at :87; worker_runtime SELECT at :91-93); no RLS.  
**Invariant violated / concern:** Defense-in-depth. Instance settings are global configuration; with no RLS, app_runtime can read and write all of them with no DB-level guard. Lower severity than the authz tables because the data is instance-global (not per-user private content), but it is still a privileged config surface that an app-runtime flaw could tamper with (e.g. flipping a security-relevant instance flag).  
**Detail:** One of the 5 created-but-no-RLS tables. Whether row scoping makes sense depends on the row shape; if it is genuinely a singleton/global table, an admin-write policy still belongs here so writes are constrained to the intended actor.  
**Suggested fix:** Add `ENABLE`+`FORCE ROW LEVEL SECURITY` with a policy that constrains writes to admin/owner actors (read may be `USING (true)` for app_runtime if settings are non-secret), so a non-admin app-runtime context cannot mutate instance config even under a logic bug.

---

#### [MED] `app.workspaces` and `app.admin_audit_events` created with grants but NO row-level security

**File:** `infra/postgres/migrations/0004_auth_workspaces_settings.sql:87,91` (`workspaces`: app SELECT/INSERT/UPDATE + worker SELECT); `infra/postgres/migrations/0005_admin_audit_events.sql:18` (`admin_audit_events`: app SELECT/INSERT). No RLS on either.  
**Invariant violated / concern:** Defense-in-depth. `admin_audit_events` is the audit trail; without RLS, app_runtime can SELECT every actor's audit rows (cross-user visibility) and INSERT arbitrary audit records. `workspaces` is part of the half-deprecated workspace machinery (see HIGH above).  
**Detail:** Two of the 5 created-but-no-RLS tables. `admin_audit_events` deliberately has no DELETE grant (append-only by grant design, good), but the missing SELECT policy still allows cross-user audit reads. `workspaces` should be resolved together with `workspace_memberships`.  
**Suggested fix:** For `admin_audit_events`: `ENABLE`+`FORCE RLS`, SELECT policy scoped to the actor's own events (`actor_user_id = app.current_actor_user_id()`) or admin-only, INSERT `WITH CHECK` on the actor column; keep the no-DELETE posture. For `workspaces`: fold into the teardown-or-protect decision from the HIGH finding.

---

#### [MED] Several RLS policies omit the `TO <role>` clause, so they apply to PUBLIC instead of the intended runtime role

**File:** `packages/chat/sql/0042_chat_memory_settings.sql:16,20,24,28` (`chat_user_memory_settings`) and `packages/memory/sql/0041_memory_facts.sql:29,33,37,41` (`chat_memory_facts`).  
**Invariant violated / concern:** Consistency / least-privilege of policy scope. Every other table in the codebase scopes its policies `TO jarvis_app_runtime` (and `jarvis_worker_runtime` where needed). These two tables' policies are written `FOR SELECT USING (owner_user_id = app.current_actor_user_id())` with no `TO` clause, so they implicitly target PUBLIC.  
**Detail:** Functionally these still fail-closed for the runtime roles (the `owner_user_id = current_actor_user_id()` predicate is the real guard, and `current_actor_user_id()` returns NULL when unset), so this is not an exploitable bypass today. But a PUBLIC-scoped permissive policy means any future role added to the DB inherits these policies by default, and it breaks the uniform `TO`-scoped convention that the rest of the schema relies on for auditability. Both tables do also grant the worker role DML (`0042:31`, `0041:45`) but only define the actor predicate once for PUBLIC — fine today, fragile later.  
**Suggested fix:** Rewrite both files' policies to be explicit: `... FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime USING (...)` (and matching `WITH CHECK` on INSERT/UPDATE), mirroring the pattern in the other module SQL files. Since these are not yet-applied edits to already-applied migrations only if they have not shipped — if they are already applied, add a corrective follow-up migration that `DROP POLICY` + recreates with the `TO` clause (never edit the applied file; the runner hash-checks it — `sql-runner.ts:61-64`).

---

#### [LOW] Two parallel cross-user grant systems — `resource_grants` (RLS-naked, app-mediated) duplicates `shares`/`has_share` (RLS-enforced, canonical)

**File:** dead/legacy path: `infra/postgres/migrations/0002_app_rls.sql:43` (`has_resource_grant()` helper), `resource_grants` table + `packages/settings/src/repository.ts:262-329`. Canonical path: `infra/postgres/migrations/0017_shares.sql` (`shares` + `app.has_share()`), used by every owner-or-share policy (e.g. tasks 0019, chat 0025, after the 0028 probe rewrite).  
**Invariant violated / concern:** "Remove dead vocabulary/scaffolding in the same pass." There are now two mechanisms for cross-user access. Policies enforce access via `app.has_share` (RLS-backed). `resource_grants` is still written by the settings repository and still granted to app_runtime, but `has_resource_grant()` no longer appears in any live policy — so grants written there are not consulted by RLS at all. This is confusing and a latent foot-gun (an operator may grant via `resource_grants` and expect it to take effect).  
**Detail:** Combined with the HIGH `resource_grants` RLS gap, the cleanest resolution is removal, not adding RLS to a superseded table. Verify no remaining policy references `has_resource_grant` before dropping.  
**Suggested fix:** Decide the canonical model is `shares`; migrate any remaining `resource_grants`/`workspace_memberships` callers in `packages/settings` and `packages/auth` onto `shares`, then drop `resource_grants`, `has_resource_grant()`, and the workspace tables in a single teardown migration. If they must stay short-term, add the RLS from the HIGH findings as a stopgap and file an issue to remove.

---

#### [LOW] Dev role passwords are hard-coded plaintext in bootstrap SQL

**File:** `infra/postgres/bootstrap/0000_roles.sql:4,6,10,12,16,18,22,24`.  
**Invariant violated / concern:** Secrets hygiene (low because these are local-dev bootstrap credentials, not production secrets, and the file is dev infra). The four runtime roles are created with literal passwords (`'app_password'`, `'worker_password'`, etc.).  
**Detail:** Acceptable for the Docker-Compose dev DB, but worth a guard so these literals can never reach a non-dev deployment. The roles are correctly `NOBYPASSRLS`/`NOSUPERUSER`/`NOINHERIT`, so the blast radius is contained even if reused.  
**Suggested fix:** Drive passwords from environment variables in the bootstrap (or document explicitly that this file is dev-only and production provisioning uses a separate mechanism). Ensure no production path runs this file verbatim.

---

#### [INFO] BYPASSRLS is clean across all roles

**File:** `infra/postgres/bootstrap/0000_roles.sql:35,43,51,59`.  
**Detail:** All four roles (`jarvis_migration_owner`, `jarvis_app_runtime`, `jarvis_worker_runtime`, `jarvis_auth_runtime`) are explicitly `NOBYPASSRLS` + `NOSUPERUSER` + `NOINHERIT`. No `BYPASSRLS` grant appears anywhere in the SQL tree. Hard invariant #1 ("no BYPASSRLS on runtime app or worker roles") is upheld. The only privilege-elevation paths are SECURITY DEFINER functions (count_all_users, resolve_auth_session, list_connector_account_safe_metadata), each narrowly scoped and returning only non-secret fields.

---

#### [INFO] Auth-secret tables are correctly FORCE-RLS'd and revoked from app/worker

**File:** `infra/postgres/migrations/0045_auth_secret_rls.sql`, `infra/postgres/migrations/0046_auth_sessions_rls.sql`.  
**Detail:** `auth_accounts`, `better_auth_sessions`, `auth_sessions` (id IS a bearer token), and `auth_verifications` are `ENABLE`+`FORCE ROW LEVEL SECURITY`, access revoked from `jarvis_app_runtime`/`jarvis_worker_runtime`, and restricted `TO jarvis_auth_runtime`. App-runtime reaches sessions only through the SECURITY DEFINER `app.resolve_auth_session()` (0046:48-71), which returns only `user_id`, never token material. This is exactly the right shape and closes the prior bearer-token-impersonation gap.

---

#### [INFO] `app.users` is ENABLE-but-not-FORCE — confirmed a deliberate, documented exception

**File:** `infra/postgres/migrations/0045_auth_secret_rls.sql:46-51`.  
**Detail:** `users` is `ENABLE` without `FORCE` so the table owner (`jarvis_migration_owner`) can read it inside SECURITY DEFINER admin-check functions (e.g. `list_connector_account_safe_metadata`). Runtime roles are not the owner and remain fully policy-controlled (self-row writes, all-row SELECT for app_runtime, self-row SELECT for worker). The reasoning is documented inline and the auth-secret tables correctly keep FORCE. Acceptable; flagged only so a future reviewer does not "fix" it by adding FORCE and breaking the definer functions.

---

#### [INFO] Migration hash-integrity enforcement is real and correct

**File:** `packages/db/src/migrations/sql-runner.ts:61-64` (checksum mismatch throws "Migration … has changed after being applied"), `:136` (sha256 of file SQL), per-file BEGIN/COMMIT/ROLLBACK with advisory lock; orchestrated by `scripts/migrate.ts` (infra migrations, then each module's `sql/` dir, then pg-boss, then grants).  
**Detail:** Hard invariant "never edit applied migrations" is machine-enforced. Note for future authoring: `schema_migrations` is keyed on the numeric prefix (`version = name.split("_")[0]`), and ALL migration directories (infra + every module) feed the SAME table, so the global numeric sequence (0001–0046) must stay collision-free across infra and modules — currently it is. `bootstrap/` and `grants/` run via `runSqlFiles` (no hash check) and so must remain idempotent (they are: `IF NOT EXISTS`, `CREATE OR REPLACE`, `GRANT`/`REVOKE`).

---

#### [INFO] Module SQL isolation, pg-boss protection, and pgvector image all verified clean

**File:** `infra/docker-compose.yml:26` (`pgvector/pgvector:pg17`), `infra/postgres/bootstrap/0001_extensions.sql` (`CREATE EXTENSION IF NOT EXISTS vector`), `infra/postgres/grants/0001_pgboss_runtime_grants.sql`.  
**Detail:** No module SQL lives under `infra/postgres/migrations/` — all module DDL is in the owning module's `sql/` dir (invariant upheld). pgvector image is correct (not reverted to `postgres:17-alpine`). pg-boss tables have no RLS, which is acceptable per the documented model (pg-boss is library-managed and the app guarantees metadata-only payloads at the application layer); the grants file correctly `REVOKE ALL ON FUNCTIONS FROM PUBLIC` and grants only app+worker runtime the needed DML on the `pgboss` schema. No secrets in any SQL beyond the dev role passwords noted above.

---

### Observations carried to later phases (not Phase-1 findings)

- **Worker grant asymmetry to verify in Phase 7 (API/worker):** `calendar_events`/`email_messages` (calendar-email module) and `commitments`/`entities` (structured-state 0031) grant only `jarvis_app_runtime`, no `jarvis_worker_runtime`, even though connector sync and AI-inferred writes may execute in the worker. RLS itself is correct (owner-or-share). This is a *grant-completeness* question, not an RLS hole — confirm against where sync/inference actually runs in TS before treating as a defect.
