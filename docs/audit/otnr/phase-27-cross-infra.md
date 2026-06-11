## Phase 27 — Infrastructure & Migrations

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 0
- MED: 6
- LOW: 4
- INFO: 6

### Findings

#### [MED] FK `task_tag_assignments.tag_id` has no covering index (cascade-delete seq scan / lock risk)
**File:** `packages/tasks/sql/0039_tasks_foundation.sql:27-31`  
**Invariant violated / concern:** Quality smell — FK without an index (delete-lock / seq-scan risk).  
**Detail:** `task_tag_assignments` has `PRIMARY KEY (task_id, tag_id)`. The PK index covers the `task_id` FK (leading column) but NOT the `tag_id` FK. `tag_id` references `app.task_tags(id) ON DELETE CASCADE`, so every `DELETE FROM app.task_tags` forces a sequential scan of `task_tag_assignments` to find referencing rows, taking a row-level lock on the parent during the scan. On a busy multi-user instance this is a correctness-preserving but unbounded-cost operation.  
**Suggested fix:** Add `CREATE INDEX IF NOT EXISTS task_tag_assignments_tag_id_idx ON app.task_tag_assignments (tag_id);` in a new migration (never edit 0039 — it is applied/hash-checked).

#### [MED] FK `tasks.list_id` (ON DELETE RESTRICT) has no dedicated index
**File:** `packages/tasks/sql/0039_tasks_foundation.sql:46,75`  
**Invariant violated / concern:** Quality smell — FK without an index (delete-lock / seq-scan risk).  
**Detail:** `app.tasks.list_id` references `app.task_lists(id) ON DELETE RESTRICT` and is `SET NOT NULL`. None of the indexes created in this migration lead with `list_id` (`tasks_drift_idx` leads with `owner_user_id`, `tasks_parent_position_idx` leads with `parent_task_id`). Deleting a `task_list` triggers a RESTRICT check that must seq-scan `app.tasks` to prove no task references it. List deletion is a normal user action, so this is a real per-operation full-table scan.  
**Suggested fix:** New migration adding `CREATE INDEX IF NOT EXISTS tasks_list_id_idx ON app.tasks (list_id);`.

#### [MED] FK `chat_memory_facts.source_thread_id` (ON DELETE SET NULL) has no index
**File:** `packages/memory/sql/0041_memory_facts.sql:9,19-23`  
**Invariant violated / concern:** Quality smell — FK without an index (delete-lock / seq-scan risk).  
**Detail:** `source_thread_id uuid REFERENCES app.chat_threads(id) ON DELETE SET NULL`. The two indexes created (`chat_memory_facts_owner_idx`, `chat_memory_facts_status_idx`) both lead with `owner_user_id`; neither covers `source_thread_id`. Deleting any chat thread forces a seq scan of `chat_memory_facts` to null out references. Thread deletion is a routine action.  
**Suggested fix:** New migration adding `CREATE INDEX IF NOT EXISTS chat_memory_facts_source_thread_idx ON app.chat_memory_facts (source_thread_id) WHERE source_thread_id IS NOT NULL;`.

#### [MED] RLS policies created without an explicit `TO` role (default PUBLIC) — breaks the codebase convention
**File:** `packages/memory/sql/0041_memory_facts.sql:28-42`, `packages/chat/sql/0042_chat_memory_settings.sql:15-29`  
**Invariant violated / concern:** Hard invariant #2 (private by default) — adherence is correct here, but the policy targeting deviates from the enforced pattern, weakening the audit boundary.  
**Detail:** Every other migration scopes its policies `TO jarvis_app_runtime` (and explicitly adds `jarvis_worker_runtime` where the worker legitimately needs access — see 0036/0037/0040). These two migrations omit the `TO` clause entirely, so the policies apply to PUBLIC (all roles, including `jarvis_migration_owner`, `jarvis_auth_runtime`, and `jarvis_worker_runtime`). For `chat_memory_facts` 0041 ALSO grants the worker full DML (`line 45`) while relying on a PUBLIC policy to scope it — the worker's access is implicit rather than declared. The `USING (owner_user_id = current_actor_user_id())` predicate still constrains rows, so this is not an open hole today, but it diverges from the reviewed, role-scoped pattern and makes "which role can touch this table" unreadable from the policy.  
**Suggested fix:** New migration recreating both tables' policies with explicit `TO jarvis_app_runtime` (and `TO jarvis_app_runtime, jarvis_worker_runtime` for the chat_memory_facts policies the worker must satisfy), matching 0024/0030/0031.

#### [MED] `task_tag_assignments` RLS checks existence, not ownership, of the parent task
**File:** `packages/tasks/sql/0039_tasks_foundation.sql:154-156`  
**Invariant violated / concern:** Hard invariant #2 (private by default) — relies on a second layer (RLS on `app.tasks`) rather than asserting ownership directly.  
**Detail:** `task_tag_assignments_rw` uses `USING (EXISTS (SELECT 1 FROM app.tasks t WHERE t.id = task_id))`. Unlike every sibling policy (`owner_user_id = app.current_actor_user_id()`), this asserts only that the referenced task *exists*. It is safe only because the nested `SELECT FROM app.tasks` is itself subject to the owner-only RLS on `app.tasks` for `jarvis_app_runtime`, so the subquery sees only the actor's own tasks. That is correct but fragile: the join table's access control is delegated entirely to another table's policy. If `app.tasks` ever gains a share-based SELECT arm (it already has owner-or-share semantics in 0019), a recipient could attach/detach tags on a shared task without a `contribute`/`manage` check.  
**Suggested fix:** New migration making the predicate explicit, e.g. `USING (EXISTS (SELECT 1 FROM app.tasks t WHERE t.id = task_id AND t.owner_user_id = app.current_actor_user_id()))`, and decide deliberately whether share-recipients may mutate tags.

#### [MED] Shared `schema_migrations` table keyed by version-only across all directories — latent collision risk
**File:** `packages/db/src/migrations/sql-runner.ts:36-68`, `scripts/migrate.ts:17-31`  
**Invariant violated / concern:** Hard invariant #11 (never edit applied migrations; hash-checked) — the tracking model that enforces it has a cross-directory ambiguity.  
**Detail:** `runSqlMigrations` is invoked once per directory (infra, then each module's `sql/`), but all invocations default to `migrationsSchema='app'`, `migrationsTable='schema_migrations'`, with `PRIMARY KEY (version)` where `version` is just the numeric filename prefix. The discovered files are sorted **within each directory independently**, and applied state is keyed solely by that numeric prefix. Today the global-numbering convention (0001–0046, no duplicates — verified) prevents collisions, but nothing in the runner enforces it: if a future module adds e.g. `0013_*.sql` while `packages/ai/sql/0013_ai_module.sql` already owns `0013`, the second one to run hits the checksum mismatch branch and throws `"Migration … has changed after being applied"` — a misleading error for what is actually a version collision, and the ordering across directories depends on `getBuiltInSqlMigrationDirectories()` registry order, not the numeric prefix.  
**Suggested fix:** Either key the table by `(directory_or_module, version)` / store a source tag, or add a pre-flight assertion in `scripts/migrate.ts` that the union of version prefixes across all directories is collision-free and contiguous (modulo documented gaps), failing fast with a clear message.

#### [LOW] `app.users` is ENABLE but not FORCE RLS — table owner bypasses row security
**File:** `infra/postgres/migrations/0045_auth_secret_rls.sql:46-51`  
**Invariant violated / concern:** Hard invariant #1 (RLS applies to all actors) — partially relaxed for the table owner by design.  
**Detail:** `app.users` gets `ENABLE` but deliberately NOT `FORCE` RLS, so `jarvis_migration_owner` (the table owner) bypasses the policies. The inline comment justifies this: SECURITY DEFINER functions owned by `migration_owner` (e.g. `app.list_connector_account_safe_metadata`) must read `users` for admin checks. This does not violate the invariant for runtime roles (`jarvis_app_runtime`/`worker`/`auth` are not the owner and remain fully policy-controlled), and `migration_owner` is not a runtime/connection role for app traffic. It is nonetheless a deviation worth keeping visible: any future SECURITY DEFINER function owned by `migration_owner` silently gets unrestricted `users` reads.  
**Suggested fix:** Keep, but add a regression test asserting `relforcerowsecurity = false` only for `app.users` and `true` for every other product table, so an accidental owner-owned function reading another table is caught.

#### [LOW] `connector_oauth_pending` and `connector_accounts.provider_id` FKs to `connector_definitions` lack indexes
**File:** `packages/connectors/sql/0044_google_unified_connection.sql:34`, `packages/connectors/sql/0009_connectors_module.sql:44,61`  
**Invariant violated / concern:** Quality smell — FK without index.  
**Detail:** `connector_oauth_pending.provider_id` references `connector_definitions(provider_id)` with no index; `connector_accounts.provider_id` does have `connector_accounts_provider_id_idx` (0009:61) so it is fine. The risk is limited because `connector_definitions` is a tiny, effectively-static seed table and the FK is RESTRICT (deletes never happen in normal operation), so the missing index on the pending table is low impact.  
**Suggested fix:** Optional `CREATE INDEX … connector_oauth_pending (provider_id)` if definitions ever become mutable; otherwise document as intentionally omitted.

#### [LOW] Bootstrap bakes fixed dev passwords into role creation
**File:** `infra/postgres/bootstrap/0000_roles.sql:4,10,16,22`  
**Invariant violated / concern:** Hard invariant #5 (secrets never escape) — not violated (dev-only), but committed credentials.  
**Detail:** The bootstrap creates the four roles with hardcoded literals (`migration_password`, `app_password`, `worker_password`, `auth_password`) and `ALTER ROLE … PASSWORD` on every run, matching the dev passwords in `docker-compose.yml`. `infra/env.production.example` correctly instructs operators to use distinct production passwords, but the bootstrap SQL itself will reset these roles to the dev passwords if it is ever run against a production database (it runs as part of `pnpm db:migrate`). In production the `ALTER ROLE … PASSWORD` lines would clobber operator-set passwords back to the weak defaults.  
**Suggested fix:** Parameterize the bootstrap passwords from env (e.g. via `psql` variables / a templated bootstrap) or guard the `ALTER ROLE … PASSWORD` so it only runs when the role is freshly created, so re-running bootstrap in production cannot reset credentials to the committed defaults.

#### [LOW] `runSqlFiles` (bootstrap + grants) is unbounded re-execution with no hash tracking
**File:** `packages/db/src/migrations/sql-runner.ts:98-116`, `scripts/migrate.ts:15,34`  
**Invariant violated / concern:** Quality smell — two migration mechanisms with different guarantees.  
**Detail:** Bootstrap and grants are applied via `runSqlFiles`, which re-runs every `.sql` file unconditionally on each `db:migrate` with no transaction wrapping, no checksum check, and no applied-state table. This is acceptable today because those files are written to be idempotent (`CREATE … IF NOT EXISTS`, `GRANT`, `REVOKE`, `CREATE OR REPLACE`). But it means the hash-check invariant (#11) does NOT protect bootstrap/grants: an edit to `0000_roles.sql` or `0001_pgboss_runtime_grants.sql` silently re-applies with no detection, and a non-idempotent statement slipped into a grants file would fail or drift without the "changed after applied" guard that protects the numbered migrations.  
**Suggested fix:** Keep the split, but document the contract loudly at the top of `runSqlFiles` and in both directories ("every statement MUST be idempotent and side-effect-free on re-run"); optionally wrap each file in a transaction so a mid-file failure rolls back.

#### [INFO] Migration number gaps 0006/0007 are intentional (notes module removed)
**File:** `infra/postgres/migrations/0027_notes_teardown.sql:1-7`  
**Invariant violated / concern:** Reviewed — clean.  
**Detail:** The combined infra+module migration set spans 0001–0046 with exactly two gaps, 0006 and 0007. Both belonged to the removed `packages/notes` module; 0027 drops `app.notes` and the comment documents that 0006/0007 are no longer discovered on fresh databases. No collisions, no duplicate prefixes (verified across `infra/postgres/migrations` + all `packages/*/sql`).  
**Suggested fix:** None.

#### [INFO] pgvector installed once in bootstrap, never re-installed in a migration
**File:** `infra/postgres/bootstrap/0001_extensions.sql:1-3`, `infra/docker-compose.yml:26`  
**Invariant violated / concern:** Hard invariant #10 (pgvector image) — satisfied.  
**Detail:** Compose uses `pgvector/pgvector:pg17`. `CREATE EXTENSION IF NOT EXISTS vector` runs once in bootstrap as superuser; no migration re-creates or assumes a different install path. `memory_chunks.embedding vector(768)` and the HNSW index (0030/0032) consume it correctly.  
**Suggested fix:** None.

#### [INFO] Role separation (migration_owner / app / worker / auth) is correct; no BYPASSRLS
**File:** `infra/postgres/bootstrap/0000_roles.sql:29-59`  
**Invariant violated / concern:** Hard invariant #1 — satisfied.  
**Detail:** All four roles are `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`. `jarvis_auth_runtime` exclusively holds the secret-bearing tables (`auth_accounts`, `better_auth_sessions`, `auth_sessions`, `auth_verifications`) after 0045/0046; `app_runtime`'s access to those was revoked. The `GRANT jarvis_auth_runtime TO jarvis_migration_owner` (0000:74) is used only at migration time for `ALTER FUNCTION … OWNER TO`, and `migration_owner`'s `NOINHERIT` means it does not passively gain auth privileges at runtime. The SECURITY DEFINER bridges (`count_all_users`, `resolve_auth_session`) return only IDs/counts, never tokens or hashes.  
**Suggested fix:** None.

#### [INFO] Secret material is encrypted-at-rest and never granted in plaintext-leaking form
**File:** `packages/connectors/sql/0009_connectors_module.sql:48`, `packages/ai/sql/0013_ai_module.sql:45`, `packages/connectors/sql/0044_google_unified_connection.sql:36`  
**Invariant violated / concern:** Hard invariant #5 — satisfied at the schema layer.  
**Detail:** Connector and AI secrets live in `encrypted_secret`/`encrypted_credential jsonb` columns (AES-256-GCM at the app layer). `app.list_connector_account_safe_metadata()` (0010) deliberately exposes only `has_secret boolean`, never the ciphertext, and is owner-scoped to instance admins. The OAuth PKCE/verifier in `connector_oauth_pending.encrypted_secret` is likewise stored encrypted; only the CSRF `state` is plaintext (correct — it is not a secret-at-rest).  
**Suggested fix:** None.

#### [INFO] Worker role reads `ai_provider_configs` (encrypted credential) — by design for async AI calls
**File:** `packages/ai/sql/0037_ai_worker_read_grants.sql:12-13`, `packages/chat/sql/0036_chat_worker_runtime_grants.sql:16-17`  
**Invariant violated / concern:** Hard invariant #5 / #6 — not violated; documented for visibility.  
**Detail:** The chat-execution worker (`jarvis_worker_runtime`) is granted SELECT on `ai_provider_configs`/`ai_configured_models` so `packages/chat/src/jobs.ts` can load the owner's provider config (including the encrypted credential) and decrypt it in-process to make the AI call. The credential reaches the worker only as ciphertext at rest; the pg-boss payload (invariant #6) still carries only IDs (this phase did not audit the payload shape — see the jobs/chat phases). The worker's policy access is owner-scoped (`owner_user_id = current_actor_user_id()`), so it can only read configs for the actor whose job it is running.  
**Suggested fix:** None — confirm in the jobs-payload phase that the decrypted credential never enters a pg-boss payload or log.

#### [INFO] `0032` and `0040` mutate derived/rebuildable data; truncation is documented and justified
**File:** `packages/memory/sql/0032_memory_embedding_768.sql:1-13`  
**Invariant violated / concern:** Reviewed — data drop is justified.  
**Detail:** 0032 `TRUNCATE`s `memory_chunks` and `memory_links` to widen the embedding vector from 384→768 dims (nomic-embed-text-v1.5), dropping/rebuilding the HNSW index correctly (drop index → alter type → recreate index). The header comment justifies it: these tables are a derived index fully reconstructable by re-scanning the vault. No source-of-truth data is destroyed. 0040 widens a CHECK constraint (`source_kind` += 'chat') with no data loss. This is the only `TRUNCATE`/destructive migration in the set and it is appropriately scoped to derived data.  
**Suggested fix:** None.
