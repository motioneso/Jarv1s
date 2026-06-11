# Audit Slice A — RLS Least-Privilege Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two RLS least-privilege gaps: a `BEFORE UPDATE` trigger that blocks non-admin self-escalation of `is_instance_admin` on `app.users` (#97), and owner-scoped worker policies on `app.memory_chunks`, `app.memory_file_index`, and `app.memory_links` that fix silent-deny of worker memory writes (#98).

**Architecture:** Two new migration files (no application code changes). The trigger adds a guard function that checks `app.current_actor_is_admin()` — already used in 0050 — skipping enforcement when no actor GUC is set (bootstrap/migration context). The worker policies mirror the existing `jarvis_app_runtime` owner-scoped policies for exactly the grants that migration 0040 added to `jarvis_worker_runtime`.

**Tech Stack:** PostgreSQL migrations (plain SQL), Vitest integration tests (`pg` Client), existing `connectionStrings.app` / `connectionStrings.worker` connection helpers, `resetEmptyFoundationDatabase` from `tests/integration/test-database.ts`.

---

## File Structure

| File                                                          | Action | Purpose                                       |
| ------------------------------------------------------------- | ------ | --------------------------------------------- |
| `infra/postgres/migrations/<NNNN>_users_guard_admin_flag.sql` | Create | Trigger function + trigger on app.users (#97) |
| `packages/memory/sql/<NNNN+1>_worker_memory_rls.sql`          | Create | 9 worker policies on memory tables (#98)      |
| `tests/integration/auth-settings.test.ts`                     | Modify | Add 3 trigger behaviour tests (#97)           |
| `tests/integration/chat-recall.test.ts`                       | Modify | Add 3 worker RLS behaviour tests (#98)        |
| `tests/integration/foundation.test.ts`                        | Modify | Add 2 new migration versions to registry      |

**Migration number assignment rule:** At implementation time, run:

```bash
ls infra/postgres/migrations/*.sql packages/*/sql/*.sql | sed 's|.*/\([0-9]*\)_.*|\1|' | sort -n | tail -1
```

Current high-water = `0052`, so the expected next two are `0053` and `0054`. If something has landed since, use the actual current high-water + 1 and + 2. Update every filename, `foundation.test.ts` entry, and migration content to match.

---

## Task 1: Write failing tests for the #97 trigger

**Files:**

- Modify: `tests/integration/auth-settings.test.ts`

- [ ] **Step 1: Locate the insertion point**

  Open `tests/integration/auth-settings.test.ts`. Scroll to the very end of the file (before the last closing `}`). Add the new `describe` block after the final existing `describe` block but before the helper functions at the bottom. The helpers `cookieHeader`, `readOriginalAuthEnv`, `restoreAuthEnv` live at the end — insert the new block just before them.

- [ ] **Step 2: Add the describe block**

  Add the following after the last describe block's closing `});` and before `function cookieHeader`:

  ```typescript
  describe("users_guard_admin_flag trigger (#97)", () => {
    beforeAll(async () => {
      await resetEmptyFoundationDatabase();
      const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
      await seed.connect();
      try {
        await seed.query(
          `INSERT INTO app.users (id, email, name, is_instance_admin)
           VALUES
             ($1, 'trigger-non-admin@test.test', 'Non Admin', false),
             ($2, 'trigger-admin@test.test',     'Admin',     true)`,
          [ids.userA, ids.adminUser]
        );
      } finally {
        await seed.end();
      }
    });

    it("rejects non-admin self-escalation of is_instance_admin", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.app });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.current_actor_user_id = '${ids.userA}'`);
        await expect(
          client.query(`UPDATE app.users SET is_instance_admin = true WHERE id = $1`, [ids.userA])
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
      }
    });

    it("allows an active admin to change is_instance_admin on another user", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.app });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.current_actor_user_id = '${ids.adminUser}'`);
        const result = await client.query(
          `UPDATE app.users SET is_instance_admin = false WHERE id = $1`,
          [ids.userA]
        );
        expect(result.rowCount).toBe(1);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
      }
    });

    it("allows non-admin to update safe columns on their own row", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.app });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.current_actor_user_id = '${ids.userA}'`);
        const result = await client.query(
          `UPDATE app.users SET name = 'Updated Name' WHERE id = $1`,
          [ids.userA]
        );
        expect(result.rowCount).toBe(1);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
      }
    });
  });
  ```

  `ids`, `connectionStrings`, `resetEmptyFoundationDatabase` are already imported at the top of this file. `pg` is imported as `import * as pg from "pg"` — check the existing import; use whatever alias is already there (look for `new pg.Client` usage in the file).

- [ ] **Step 3: Run the new tests to confirm they fail**

  ```bash
  vitest run tests/integration/auth-settings.test.ts --reporter=verbose 2>&1 | grep -A3 "users_guard_admin_flag\|FAIL\|PASS"
  ```

  Expected: the three new tests FAIL (trigger does not exist yet — the self-escalation UPDATE succeeds when it should not). The existing tests in the file continue to PASS.

---

## Task 2: Write failing tests for the #98 worker memory RLS

**Files:**

- Modify: `tests/integration/chat-recall.test.ts`

- [ ] **Step 1: Add the describe block at the end of chat-recall.test.ts**

  Open `tests/integration/chat-recall.test.ts`. Append the following after the last `});`:

  ```typescript
  describe("worker_runtime RLS policies on memory tables (#98)", () => {
    beforeAll(async () => {
      await resetEmptyFoundationDatabase();
      const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
      await seed.connect();
      try {
        await seed.query(
          `INSERT INTO app.users (id, email, name) VALUES
             ($1, 'worker-a@test.test', 'Worker A'),
             ($2, 'worker-b@test.test', 'Worker B')`,
          [ids.userA, ids.userB]
        );
        // Pre-seed one chunk per user so SELECT isolation is testable
        await seed.query(
          `INSERT INTO app.memory_chunks
             (owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text)
           VALUES
             ($1, 'chat', '/worker-a/path', 0, 1, 'hash-seed-a', 'chunk a'),
             ($2, 'chat', '/worker-b/path', 0, 1, 'hash-seed-b', 'chunk b')`,
          [ids.userA, ids.userB]
        );
      } finally {
        await seed.end();
      }
    });

    it("worker can INSERT into memory_chunks for its own actor", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.worker });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.current_actor_user_id = '${ids.userA}'`);
        const result = await client.query(
          `INSERT INTO app.memory_chunks
             (owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text)
           VALUES ($1, 'chat', '/worker-a/new', 0, 1, 'hash-new', 'new chunk')
           RETURNING id`,
          [ids.userA]
        );
        expect(result.rowCount).toBe(1);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
      }
    });

    it("worker INSERT on memory_chunks is rejected when owner_user_id does not match actor", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.worker });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.current_actor_user_id = '${ids.userA}'`);
        await expect(
          client.query(
            `INSERT INTO app.memory_chunks
               (owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text)
             VALUES ($1, 'chat', '/forged/path', 0, 1, 'hash-forged', 'forged chunk')`,
            [ids.userB]
          )
        ).rejects.toThrow();
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
      }
    });

    it("worker SELECT on memory_chunks returns only the actor's rows", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.worker });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.current_actor_user_id = '${ids.userA}'`);
        const result = await client.query<{ source_path: string }>(
          `SELECT source_path FROM app.memory_chunks`
        );
        const paths = result.rows.map((r) => r.source_path);
        expect(paths).toContain("/worker-a/path");
        expect(paths).not.toContain("/worker-b/path");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
      }
    });
  });
  ```

  `pg`, `ids`, `connectionStrings`, `resetEmptyFoundationDatabase` are already imported in this file.

- [ ] **Step 2: Run the new tests to confirm they fail**

  ```bash
  vitest run tests/integration/chat-recall.test.ts --reporter=verbose 2>&1 | grep -A3 "worker_runtime RLS\|FAIL\|PASS"
  ```

  Expected: the three new tests FAIL (no worker policies exist — FORCE RLS silently denies the INSERT, returning rowCount 0 instead of 1, and the SELECT may error or return 0 rows). Existing tests PASS.

---

## Task 3: Write migration NNNN — users_guard_admin_flag

**Files:**

- Create: `infra/postgres/migrations/<NNNN>_users_guard_admin_flag.sql`

Replace `<NNNN>` with the actual next migration number you determined at the start of Task 1 (expected: `0053`).

- [ ] **Step 1: Create the migration file**

  ```sql
  -- Guard app.users.is_instance_admin against non-admin self-escalation (#97).
  --
  -- The existing self-row UPDATE policy (users_app_runtime_update, 0045) checks only
  -- id = current_actor_user_id() — no column restriction. A non-admin user can therefore
  -- UPDATE their own row and set is_instance_admin = true. This trigger closes that gap by
  -- rejecting any change to is_instance_admin unless the actor is an active admin.
  --
  -- The NULL guard (current_actor_user_id() IS NOT NULL) ensures the trigger does not fire
  -- for bootstrap or migration operations where no actor GUC is set — those run outside
  -- the app_runtime security boundary and are already protected by other means.
  --
  -- Mirrors the pattern planned for #135 (incognito flag immutability via trigger).

  CREATE OR REPLACE FUNCTION app.users_guard_admin_flag()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = app, public
  AS $$
  BEGIN
    IF NEW.is_instance_admin IS DISTINCT FROM OLD.is_instance_admin
       AND app.current_actor_user_id() IS NOT NULL
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

- [ ] **Step 2: Run `pnpm db:migrate` to apply the new migration**

  ```bash
  pnpm db:migrate
  ```

  Expected: exits 0, prints the new migration filename as applied.

- [ ] **Step 3: Run the #97 trigger tests to confirm they now pass**

  ```bash
  vitest run tests/integration/auth-settings.test.ts --reporter=verbose 2>&1 | grep -A2 "users_guard_admin_flag"
  ```

  Expected: all three `users_guard_admin_flag trigger (#97)` tests PASS.

- [ ] **Step 4: Confirm the full auth-settings suite still passes**

  ```bash
  vitest run tests/integration/auth-settings.test.ts 2>&1 | tail -5
  ```

  Expected: `Tests N passed`.

---

## Task 4: Write migration NNNN+1 — worker memory RLS policies

**Files:**

- Create: `packages/memory/sql/<NNNN+1>_worker_memory_rls.sql`

Replace `<NNNN+1>` with the second migration number (expected: `0054`).

- [ ] **Step 1: Create the migration file**

  ```sql
  -- Add jarvis_worker_runtime RLS policies on memory tables (#98).
  --
  -- Migration 0040 granted jarvis_worker_runtime full DML on memory_chunks and
  -- memory_file_index, and SELECT on memory_links — required for recall embed jobs.
  -- No matching RLS policies were added in 0040, so FORCE RLS silently denies every
  -- worker write. This migration adds the missing policies, mirroring the existing
  -- jarvis_app_runtime policies with the same owner_user_id = current_actor_user_id()
  -- predicate.

  -- memory_chunks (mirrors app_runtime policies from 0030)
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

  -- memory_file_index (mirrors app_runtime policies from 0032)
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

  -- memory_links (SELECT only — 0040 gave worker only SELECT on links)
  DROP POLICY IF EXISTS memory_links_worker_select ON app.memory_links;
  CREATE POLICY memory_links_worker_select ON app.memory_links
    FOR SELECT TO jarvis_worker_runtime
    USING (owner_user_id = app.current_actor_user_id());
  ```

- [ ] **Step 2: Run `pnpm db:migrate` to apply the new migration**

  ```bash
  pnpm db:migrate
  ```

  Expected: exits 0, prints the new memory migration filename as applied.

- [ ] **Step 3: Run the #98 worker RLS tests to confirm they now pass**

  ```bash
  vitest run tests/integration/chat-recall.test.ts --reporter=verbose 2>&1 | grep -A2 "worker_runtime RLS"
  ```

  Expected: all three `worker_runtime RLS policies on memory tables (#98)` tests PASS.

- [ ] **Step 4: Run the full memory and recall suites**

  ```bash
  pnpm test:memory && vitest run tests/integration/chat-recall.test.ts 2>&1 | tail -5
  ```

  Expected: all tests pass.

---

## Task 5: Update foundation.test.ts migration registry

**Files:**

- Modify: `tests/integration/foundation.test.ts` (line ~146)

- [ ] **Step 1: Find the end of the migration list**

  Open `tests/integration/foundation.test.ts`. Find the line:

  ```typescript
        { version: "0052", name: "0052_fix_admin_select_policy.sql" }
  ```

  It's at approximately line 146.

- [ ] **Step 2: Add the two new entries**

  Change:

  ```typescript
        { version: "0052", name: "0052_fix_admin_select_policy.sql" }
  ```

  To (using the actual migration numbers you assigned — expected 0053/0054):

  ```typescript
        { version: "0052", name: "0052_fix_admin_select_policy.sql" },
        { version: "0053", name: "0053_users_guard_admin_flag.sql" },
        { version: "0054", name: "0054_worker_memory_rls.sql" }
  ```

- [ ] **Step 3: Run the foundation test to confirm it passes**

  ```bash
  vitest run tests/integration/foundation.test.ts 2>&1 | tail -5
  ```

  Expected: all tests pass, including `applies versioned SQL migrations from an empty database`.

---

## Task 6: Run the full integration suite

- [ ] **Step 1: Run the complete integration suite**

  ```bash
  pnpm test:integration 2>&1 | tail -10
  ```

  Expected: all tests pass. If any test fails, read the error, fix it, re-run.

- [ ] **Step 2: Verify the release-hardening audit still passes**

  ```bash
  pnpm audit:release-hardening 2>&1 | tail -5
  ```

  Expected: exits 0 (the new trigger and policies do not remove any FORCE RLS protection).

---

## Task 7: Commit

- [ ] **Step 1: Stage only the files created or modified by this slice**

  ```bash
  git add \
    infra/postgres/migrations/0053_users_guard_admin_flag.sql \
    packages/memory/sql/0054_worker_memory_rls.sql \
    tests/integration/auth-settings.test.ts \
    tests/integration/chat-recall.test.ts \
    tests/integration/foundation.test.ts
  ```

  (Adjust filenames if your migration numbers differ from 0053/0054.)

- [ ] **Step 2: Verify staged diff is exactly these 5 files**

  ```bash
  git diff --cached --stat
  ```

  Expected: 5 files changed, no unintended files included. If any extra files appear, unstage them with `git restore --staged <path>`.

- [ ] **Step 3: Commit**

  ```bash
  git commit -m "$(cat <<'EOF'
  security(rls): close least-priv gaps on users + worker memory (#97 #98)

  #97 — BEFORE UPDATE trigger blocks non-admin is_instance_admin self-escalation.
  Uses app.current_actor_is_admin() (SECURITY DEFINER, 0050); NULL guard preserves
  bootstrap/migration paths. Admin promote/demote (settings/repository.ts) unchanged.

  #98 — Worker RLS policies on memory_chunks, memory_file_index (SELECT/INSERT/
  UPDATE/DELETE) and memory_links (SELECT) to match the grants added by 0040.
  Fixes live silent-deny of worker recall-embed writes.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 4: Open a PR against main**

  ```bash
  gh pr create \
    --title "security(rls): close least-priv gaps on users + worker memory (#97 #98)" \
    --body "$(cat <<'EOF'
  ## Summary

  - **#97** — `BEFORE UPDATE` trigger on `app.users` blocks non-admin self-escalation of `is_instance_admin`. Guard function short-circuits when no actor GUC is set (bootstrap/migration context). The shipped admin promote/demote flow (`settings/repository.ts`) is unaffected.
  - **#98** — Owner-scoped `jarvis_worker_runtime` policies on `memory_chunks`, `memory_file_index`, and `memory_links` to match the DML grants added by migration 0040. Fixes live silent-deny of worker recall-embed writes.

  Both fixes are migrations only; no application code changes.

  Tier: **security** — needs cross-model QA + Ben's merge sign-off (per audit-remediation run manifest).

  Closes #97, closes #98.

  ## Test plan

  - [ ] `vitest run tests/integration/auth-settings.test.ts` — trigger rejection + admin-allow + safe-column tests
  - [ ] `vitest run tests/integration/chat-recall.test.ts` — worker INSERT own-row, cross-user reject, SELECT isolation
  - [ ] `pnpm test:integration` — full suite green
  - [ ] `pnpm audit:release-hardening` — exits 0

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **Step 5: Report back to the Coordinator**

  Message the `Coordinator` pane (via `herdr-pane-message` skill) with:

  ```
  [Coordinator] Slice A PR open: <PR URL>. Branch: <branch name>.
  pnpm test:integration PASSED (N tests). audit:release-hardening PASSED.
  Two migrations: 0053_users_guard_admin_flag.sql + 0054_worker_memory_rls.sql.
  Awaiting security-tier QA and Ben merge sign-off.
  ```
