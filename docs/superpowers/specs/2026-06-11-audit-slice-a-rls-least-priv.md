# Spec: Audit Slice A — RLS Least-Privilege Migrations

**Date:** 2026-06-11
**Audit issues:** #97, #98
**Tier:** `security`
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md` (first on migration spine)
**Migration count:** 2 (one per issue; numbers assigned at build time — do not pre-assign)

---

## Context

Two independent RLS gaps discovered by the multi-run audit and confirmed by Fable 5 verification
@ `origin/main e629f3c` (migration head 0052):

- **#97** — `app.users` self-row UPDATE policy has no column restriction. A non-admin user can
  `UPDATE users SET is_instance_admin = true` on their own row and pass the existing
  `id = current_actor_user_id()` check. The admin promote/demote path in
  `packages/settings/src/repository.ts:473` (shipped in PR #93) is legitimate and must keep
  working — the fix must not break it.
- **#98** — `jarvis_worker_runtime` has DML grants on `app.memory_chunks` and
  `app.memory_file_index` (added by migration `0040_memory_chat_source.sql`) but **no matching
  RLS policies**. FORCE RLS is already enabled, so every worker write is silently denied. This
  breaks chat episodic recall (the worker embed job that populates memory cannot write). This is a
  live production breakage, not a latent risk.

---

## Fix design

### #97 — BEFORE UPDATE trigger on `app.users`

**Trigger spec:**
```sql
CREATE OR REPLACE FUNCTION app.users_guard_admin_flag()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_instance_admin IS DISTINCT FROM OLD.is_instance_admin
     AND NOT app.current_actor_is_admin()
  THEN
    RAISE EXCEPTION 'permission denied: only an active admin may change is_instance_admin'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_guard_admin_flag ON app.users;
CREATE TRIGGER users_guard_admin_flag
  BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.users_guard_admin_flag();
```

**Why trigger, not column GRANT revoke:** the admin promote/demote route
(`settings/repository.ts:473`, which calls `.set({ is_instance_admin: input.isInstanceAdmin })`)
runs as `jarvis_app_runtime`. Revoking the column UPDATE grant would break that path silently.
A trigger rejects exactly the forbidden case — non-admin changing the flag — while passing
through the same code untouched when the actor is an active admin.

**Pattern consistency:** mirrors the approach planned for `#135` (incognito flag immutability
via trigger), keeping the house pattern uniform for immutable-unless-admin columns.

**`app.current_actor_is_admin()` function contract:** already exists (used in
`0050_multi_user_accounts.sql` for the admin UPDATE policy). Confirm the function exists and is
callable by `jarvis_app_runtime` before the trigger body references it.

**Migration location:** `infra/postgres/migrations/<NNNN>_users_guard_admin_flag.sql`

---

### #98 — Worker RLS policies on memory tables

**What 0040 granted** (the grants already exist — we are only adding matching policies):
- `memory_chunks`: SELECT, INSERT, UPDATE, DELETE to `jarvis_worker_runtime`
- `memory_file_index`: SELECT, INSERT, UPDATE, DELETE to `jarvis_worker_runtime`
- `memory_links`: SELECT to `jarvis_worker_runtime`

**Policies to add** (mirror the existing `app_runtime` owner-scoped policies):

```sql
-- memory_chunks (4 operations)
DROP POLICY IF EXISTS memory_chunks_worker_select ON app.memory_chunks;
CREATE POLICY memory_chunks_worker_select ON app.memory_chunks
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_chunks_worker_insert ON app.memory_chunks;
CREATE POLICY memory_chunks_worker_insert ON app.memory_chunks
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_chunks_worker_update ON app.memory_chunks;
CREATE POLICY memory_chunks_worker_update ON app.memory_chunks
  FOR UPDATE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_chunks_worker_delete ON app.memory_chunks;
CREATE POLICY memory_chunks_worker_delete ON app.memory_chunks
  FOR DELETE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

-- memory_file_index (4 operations)
DROP POLICY IF EXISTS memory_file_index_worker_select ON app.memory_file_index;
CREATE POLICY memory_file_index_worker_select ON app.memory_file_index
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_worker_insert ON app.memory_file_index;
CREATE POLICY memory_file_index_worker_insert ON app.memory_file_index
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_worker_update ON app.memory_file_index;
CREATE POLICY memory_file_index_worker_update ON app.memory_file_index
  FOR UPDATE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_worker_delete ON app.memory_file_index;
CREATE POLICY memory_file_index_worker_delete ON app.memory_file_index
  FOR DELETE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

-- memory_links (SELECT only — 0040 gave only SELECT to worker)
DROP POLICY IF EXISTS memory_links_worker_select ON app.memory_links;
CREATE POLICY memory_links_worker_select ON app.memory_links
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());
```

**No code changes required.** The worker job already sets `app.current_actor_user_id` via GUC
before its DML calls (standard worker pattern). The policies being missing was the only failure.

**Migration location:** `packages/memory/sql/<NNNN>_worker_memory_rls.sql`

---

## Hard invariants

- **Never edit applied migrations.** Both fixes are new migration files. The migration runner
  hash-checks applied files; editing 0030, 0032, 0040, 0045, 0050 is a hard blocker.
- **Never pre-assign migration numbers.** Numbers are assigned at implementation time by reading
  the current high-water mark (`ls infra/postgres/migrations/*.sql packages/*/sql/*.sql | sort -n | tail -1`). Two migrations = two sequential numbers from the same build.
- **Worker role NOBYPASSRLS** — confirmed in place. Adding policies is additive; do NOT add a
  BYPASSRLS grant or any privilege that defeats FORCE RLS.
- **Admin promote/demote path must keep working.** After the trigger is added, run
  `pnpm test:integration` and specifically confirm the settings suite passes (the admin promote/demote test exercises this path).
- **Migration spine position:** Slice A is first on the spine. Slice B (deletion) must not start
  until both Slice A migrations are numbered and merged.

---

## Tests

### #97
- **Reject self-escalation:** set GUC to a non-admin user ID; `UPDATE app.users SET is_instance_admin = true WHERE id = <self>` must raise `42501`.
- **Allow self-update of safe columns:** same non-admin user updating `name` or `email` on their own row must succeed (trigger must not over-block).
- **Allow admin promotion:** set GUC to a known admin ID; UPDATE on another user's `is_instance_admin` must succeed.
- Run `pnpm test:tasks` and `pnpm test:integration` to confirm no regressions in settings/admin flows.

### #98
- **Worker INSERT succeeds:** using `jarvis_worker_runtime` + GUC set to an actor user ID, INSERT a row into `memory_chunks` (with `owner_user_id = actor`) must succeed (not silently denied).
- **Worker cross-user INSERT rejected:** worker INSERT with `owner_user_id` != current actor must be rejected by the WITH CHECK predicate.
- **Worker SELECT cross-user blocked:** SELECT by worker for a different user's chunks must return 0 rows.
- Run `pnpm test:memory` to confirm end-to-end recall path.

---

## Migration skeleton (reference for build agent)

```
infra/postgres/migrations/<NNNN>_users_guard_admin_flag.sql
packages/memory/sql/<NNNN+1>_worker_memory_rls.sql
```

Both migrations run under `jarvis_migration_owner`. No application code changes required for
either fix. No schema changes (no new columns, tables, or sequences).

---

## Out of scope

- `memory_links` INSERT/UPDATE/DELETE worker policies — 0040 gave the worker only SELECT on links,
  so no additional policies are needed beyond the one SELECT policy above. If a future slice adds
  DML grants, add matching policies at that time.
- `#135` incognito trigger — same pattern, separate slice, separate PR.
- `#97` column-revoke + SECURITY DEFINER approach — explicitly rejected (would break the shipped
  admin promote/demote route without code changes; trigger is sufficient).
