# Fix #75 — Tighten users SELECT RLS to Self-Row + Admin SECURITY DEFINER Helpers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `users_app_runtime_select USING(true)` (identity-enumeration hole) with a self-row policy, and add `SECURITY DEFINER` SQL functions so the three legitimate cross-user/no-GUC admin paths keep working.

**Architecture:** Migration 0047 drops the wide-open policy and replaces it with `USING(id = app.current_actor_user_id())`, then creates `app.get_user_by_id(uuid)` and `app.list_all_users()` (both SECURITY DEFINER owned by `jarvis_auth_runtime`, following the 0045 `count_all_users` precedent). `SettingsRepository` is updated to call those functions instead of direct table queries for the three affected methods. The regression test is written first (RED on main) and must go GREEN after the migration.

**Tech Stack:** PostgreSQL RLS, Kysely sql tagged template, Vitest integration tests, `pg.Client` for direct role-switching tests. Risk tier: `security` — build defensively, document trust boundaries, no secrets in any artifact.

---

## Consumer Audit (Why These Three Methods)

| Method | Issue | Fix |
|---|---|---|
| `SettingsRepository.getUserById(userId)` | Uses plain Kysely (no GUC set) — even self-row reads return 0 rows after tightening | Replace with `SELECT * FROM app.get_user_by_id($1)` |
| `SettingsRepository.listUsers()` | Reads all users; no GUC | Replace with `SELECT * FROM app.list_all_users()` |
| `SettingsRepository.requireUser(userId)` | Checks existence of arbitrary user; no GUC | Replace with existence check via `app.get_user_by_id($1)` |
| `SettingsRepository.countUsers()` | Already calls `app.count_all_users()` SD function | **No change** |
| `chat.live.persistence.resolveUserName()` | Uses DataContextDb (GUC set), self-row only | **No change** |
| `bootstrapFirstJarvisUser` count+UPDATE | count via SD function; UPDATE with explicit GUC | **No change** |
| `list_connector_account_safe_metadata()` | SD owned by `jarvis_migration_owner`; users has ENABLE not FORCE RLS, so owner bypasses | **No change** |
| Connector admin policies `WHERE id = current_actor_user_id()` | Self-row sub-query in policy body | **No change** |
| All module SQL `REFERENCES app.users(id)` | DDL foreign keys, not runtime SELECT | **No change** |

`count_all_users()` still has real callers (`bootstrapFirstJarvisUser`, `/api/bootstrap/status`) — keep it; do not drop.

---

## File Map

| File | Change |
|---|---|
| `tests/integration/release-hardening.test.ts` | Add regression test (RED on main, GREEN after fix) |
| `infra/postgres/migrations/0047_users_rls_tighten.sql` | New migration: tighten policy + create 2 SD functions |
| `packages/settings/src/repository.ts` | Update 3 methods to call SD functions |

---

## Task 1 — Write the Regression Test (RED)

This test must FAIL on `origin/main` and PASS after migration 0047 is applied. Write it first.

**Files:**
- Modify: `tests/integration/release-hardening.test.ts`

- [ ] **Step 1: Locate the insertion point**

Open `tests/integration/release-hardening.test.ts`. Find the existing test at line ~394:
```
it("denies app_runtime and worker_runtime direct SELECT on auth_sessions and auth_verifications", ...)
```
Insert the new test immediately after it (before the closing `});` of the outer `describe`).

- [ ] **Step 2: Add the regression test**

The outer `describe` block in `release-hardening.test.ts` calls `resetFoundationDatabase()` in its `beforeAll`, which seeds `ids.userA`, `ids.userB`, `ids.adminUser` into `app.users` via the bootstrap connection. Those rows are already present when this test runs.

Add this test after the "denies app_runtime and worker_runtime direct SELECT" test:

```typescript
it("denies app_runtime cross-user SELECT on users when no GUC is set (users SELECT is self-row only)", async () => {
  // Connect as jarvis_app_runtime with NO actor GUC set.
  // On origin/main: USING(true) → returns all rows → count > 0 → test FAILS.
  // After migration 0047: USING(id = current_actor_user_id()) + NULL GUC → 0 rows → PASSES.
  const appClient = new pg.Client({ connectionString: connectionStrings.app });

  await appClient.connect();
  try {
    const result = await appClient.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM app.users"
    );

    expect(result.rows[0]?.count).toBe("0");
  } finally {
    await appClient.end();
  }
});
```

- [ ] **Step 3: Run the test on the current branch (must be RED)**

```bash
JARVIS_PGDATABASE=jarvis_fix75 vitest run tests/integration/release-hardening.test.ts 2>&1 | grep -A 5 "cross-user SELECT"
```

Expected: test FAILS with something like:
```
AssertionError: expected '3' to be '0'
```
(3 seeded users visible because USING(true) is still in effect on main)

If the test PASSES here, stop — the hole doesn't exist as expected. Re-check the migration state of `jarvis_fix75` database (it may already have 0047 applied).

- [ ] **Step 4: Commit the RED test**

```bash
git add tests/integration/release-hardening.test.ts
git commit -m "test(rls): regression test for users SELECT self-row restriction — RED on main

Verifies that jarvis_app_runtime cannot enumerate user rows when the actor
GUC is not set. Currently fails because users_app_runtime_select uses
USING(true); will go GREEN after migration 0047 tightens it to self-row.

Part of #75.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2 — Migration 0047: Tighten Policy + Add SD Helpers

**Files:**
- Create: `infra/postgres/migrations/0047_users_rls_tighten.sql`

Follows the `count_all_users` / `resolve_auth_session` precedent from 0045/0046 exactly.

- [ ] **Step 1: Create the migration file**

Create `infra/postgres/migrations/0047_users_rls_tighten.sql` with this content:

```sql
-- Tighten users SELECT policy (P1 remediation #75).
--
-- Migration 0045 left users_app_runtime_select USING(true): any app-runtime
-- query without a GUC set can read every user row → identity enumeration.
-- This deviates from the approved owner-only intent.
--
-- Fix:
--   1. Replace users_app_runtime_select with self-row restriction
--      (id = app.current_actor_user_id()).
--   2. Add two SECURITY DEFINER helper functions (owned by jarvis_auth_runtime)
--      for the three SettingsRepository paths that legitimately need cross-user
--      or GUC-less access to users:
--        - app.get_user_by_id(uuid)  — for getUserById and requireUser checks
--        - app.list_all_users()      — for /api/admin/users (admin list)
--   3. app.count_all_users() is unchanged (still needed by bootstrapFirstJarvisUser
--      and /api/bootstrap/status).
--
-- Pattern mirrors 0045 count_all_users / 0046 resolve_auth_session exactly.
-- jarvis_auth_runtime has USING(true) on users, so SD functions owned by it
-- can see all rows regardless of the new self-row policy on app_runtime.

-- 1. Tighten the SELECT policy on users for jarvis_app_runtime.
DROP POLICY IF EXISTS users_app_runtime_select ON app.users;

CREATE POLICY users_app_runtime_select
  ON app.users
  FOR SELECT
  TO jarvis_app_runtime
  USING (id = app.current_actor_user_id());

-- 2a. SECURITY DEFINER: get a single user by id.
--     Used by SettingsRepository.getUserById() and requireUser() checks.
CREATE OR REPLACE FUNCTION app.get_user_by_id(p_user_id uuid)
  RETURNS TABLE(
    id            uuid,
    email         text,
    name          text,
    email_verified boolean,
    image         text,
    is_instance_admin boolean,
    created_at    timestamptz,
    updated_at    timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$
  SELECT id, email, name, email_verified, image, is_instance_admin, created_at, updated_at
  FROM users
  WHERE id = p_user_id
$$;

-- 2b. SECURITY DEFINER: list all users ordered by created_at, id.
--     Used by SettingsRepository.listUsers() → /api/admin/users.
CREATE OR REPLACE FUNCTION app.list_all_users()
  RETURNS TABLE(
    id            uuid,
    email         text,
    name          text,
    email_verified boolean,
    image         text,
    is_instance_admin boolean,
    created_at    timestamptz,
    updated_at    timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$
  SELECT id, email, name, email_verified, image, is_instance_admin, created_at, updated_at
  FROM users
  ORDER BY created_at, id
$$;

-- 3. Transfer ownership of both new functions to jarvis_auth_runtime.
--    Temporary CREATE grant required by PostgreSQL ALTER FUNCTION ... OWNER TO.
GRANT CREATE ON SCHEMA app TO jarvis_auth_runtime;

ALTER FUNCTION app.get_user_by_id(uuid) OWNER TO jarvis_auth_runtime;
ALTER FUNCTION app.list_all_users() OWNER TO jarvis_auth_runtime;

REVOKE CREATE ON SCHEMA app FROM jarvis_auth_runtime;

-- 4. Lock down execute: only jarvis_app_runtime may call these functions.
SET LOCAL ROLE jarvis_auth_runtime;

REVOKE EXECUTE ON FUNCTION app.get_user_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_user_by_id(uuid) TO jarvis_app_runtime;

REVOKE EXECUTE ON FUNCTION app.list_all_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_all_users() TO jarvis_app_runtime;

RESET ROLE;
```

- [ ] **Step 2: Apply the migration**

```bash
JARVIS_PGDATABASE=jarvis_fix75 pnpm db:migrate 2>&1 | tail -10
```

Expected output ends with something like:
```
Applied: 0047_users_rls_tighten.sql
Migration complete.
```
No errors.

- [ ] **Step 3: Verify regression test now passes**

```bash
JARVIS_PGDATABASE=jarvis_fix75 vitest run tests/integration/release-hardening.test.ts 2>&1 | grep -A 3 "cross-user SELECT"
```

Expected: PASS (0 rows returned with no GUC set).

- [ ] **Step 4: Commit the migration**

```bash
git add infra/postgres/migrations/0047_users_rls_tighten.sql
git commit -m "fix(rls): migration 0047 — tighten users SELECT to self-row + add SD helpers

Replaces users_app_runtime_select USING(true) with USING(id = current_actor_user_id()).
Adds app.get_user_by_id(uuid) and app.list_all_users() SECURITY DEFINER functions
(owned by jarvis_auth_runtime, GRANT EXECUTE to jarvis_app_runtime) for the three
SettingsRepository paths that need cross-user or GUC-less access.
count_all_users() is unchanged — still used by bootstrap and /api/bootstrap/status.

Resolves #75 at the DB layer. TS callers updated in next commit.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3 — Update SettingsRepository to Use the New Helpers

**Files:**
- Modify: `packages/settings/src/repository.ts`

Three methods change: `getUserById`, `listUsers`, `requireUser`. No interface changes — callers are unaffected.

- [ ] **Step 1: Check current method implementations**

Verify these three methods in `packages/settings/src/repository.ts`:

`getUserById` (lines ~73-75):
```typescript
async getUserById(userId: string): Promise<User | undefined> {
  return this.db.selectFrom("app.users").selectAll().where("id", "=", userId).executeTakeFirst();
}
```

`listUsers` (lines ~77-83):
```typescript
async listUsers(): Promise<User[]> {
  return this.db
    .selectFrom("app.users")
    .selectAll()
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}
```

`requireUser` (lines ~398-407):
```typescript
private async requireUser(userId: string, db: SettingsDb = this.db): Promise<void> {
  const user = await db
    .selectFrom("app.users")
    .select("id")
    .where("id", "=", userId)
    .executeTakeFirst();

  if (!user) {
    throw new Error("User not found");
  }
}
```

- [ ] **Step 2: Verify `sql` is already imported**

Check line 4 of `packages/settings/src/repository.ts`:
```typescript
import { sql } from "kysely";
```
It is. The `sql` tag is already used by `countUsers()` at line ~67. No new import needed.

- [ ] **Step 3: Replace `getUserById`**

Replace the existing `getUserById` method body:

Old:
```typescript
async getUserById(userId: string): Promise<User | undefined> {
  return this.db.selectFrom("app.users").selectAll().where("id", "=", userId).executeTakeFirst();
}
```

New:
```typescript
async getUserById(userId: string): Promise<User | undefined> {
  const result = await sql<User>`SELECT * FROM app.get_user_by_id(${userId}::uuid)`.execute(
    this.db
  );
  return result.rows[0];
}
```

- [ ] **Step 4: Replace `listUsers`**

Old:
```typescript
async listUsers(): Promise<User[]> {
  return this.db
    .selectFrom("app.users")
    .selectAll()
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}
```

New:
```typescript
async listUsers(): Promise<User[]> {
  const result = await sql<User>`SELECT * FROM app.list_all_users()`.execute(this.db);
  return result.rows;
}
```

- [ ] **Step 5: Replace `requireUser`**

Old:
```typescript
private async requireUser(userId: string, db: SettingsDb = this.db): Promise<void> {
  const user = await db
    .selectFrom("app.users")
    .select("id")
    .where("id", "=", userId)
    .executeTakeFirst();

  if (!user) {
    throw new Error("User not found");
  }
}
```

New:
```typescript
private async requireUser(userId: string, db: SettingsDb = this.db): Promise<void> {
  const result = await sql<{ id: string }>`SELECT id FROM app.get_user_by_id(${userId}::uuid)`.execute(
    db
  );

  if (!result.rows[0]) {
    throw new Error("User not found");
  }
}
```

- [ ] **Step 6: Run the full auth-settings integration test suite**

```bash
JARVIS_PGDATABASE=jarvis_fix75 pnpm test:tasks 2>&1 | tail -20
```

Wait, wrong suite. Run the auth-settings suite:

```bash
JARVIS_PGDATABASE=jarvis_fix75 vitest run tests/integration/auth-settings.test.ts 2>&1 | tail -20
```

Expected: all tests pass. In particular:
- "bootstraps the first Better Auth user as instance owner" — exercises `getUserById` via `requireKnownUser`
- "keeps later users non-admin and protects admin APIs" — exercises `listUsers()` via `/api/admin/users`
- "lets admins create workspaces, memberships, and settings" — exercises `requireUser` via `upsertWorkspaceMembership`
- "creates resource grants without giving admins private-data bypass" — exercises `requireUser` via `upsertResourceGrant`

- [ ] **Step 7: Run release-hardening test suite**

```bash
JARVIS_PGDATABASE=jarvis_fix75 vitest run tests/integration/release-hardening.test.ts 2>&1 | tail -20
```

Expected: all tests pass, including the new regression test.

- [ ] **Step 8: Run full integration gate**

```bash
JARVIS_PGDATABASE=jarvis_fix75 pnpm test:integration 2>&1 | tail -30
```

Expected: all suites pass.

- [ ] **Step 9: Commit the TypeScript changes**

```bash
git add packages/settings/src/repository.ts
git commit -m "fix(settings): route getUserById, listUsers, requireUser through SD functions

Three SettingsRepository methods previously did direct app.users SELECT via plain
Kysely (no GUC set). After migration 0047 tightens users_app_runtime_select to
self-row only, those queries would silently return zero rows because
current_actor_user_id() returns NULL without a set_config GUC.

Replace with SECURITY DEFINER helper calls:
  getUserById  → app.get_user_by_id(uuid)
  listUsers    → app.list_all_users()
  requireUser  → app.get_user_by_id(uuid) existence check

countUsers already uses count_all_users() SD function — unchanged.

Closes #75.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4 — Pre-Push Checks + Full Gate

- [ ] **Step 1: Pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all green (no output). If `format:check` fails, run `pnpm format` and re-stage the formatted files before the next commit. If `lint` fails, fix the lint errors. If `typecheck` fails, check that `sql<User>` infers correctly — the `User` type from `@jarv1s/db` is `Selectable<UsersTable>` with `string` ids and `Date`-coerced timestamps; `sql<User>` is a type annotation only and does not affect runtime.

- [ ] **Step 2: Fresh rebase onto origin/main**

```bash
git fetch origin main && git rebase origin/main
```

Expected: fast-forward or clean rebase, no conflicts. This is the pre-push requirement from the handoff.

- [ ] **Step 3: Full foundation gate**

```bash
JARVIS_PGDATABASE=jarvis_fix75 pnpm verify:foundation 2>&1 | tail -30
```

Expected: exits 0. Covers lint, format:check, check:file-size, typecheck, db:migrate (idempotent), test:integration.

- [ ] **Step 4: Review the diff for security audit surface**

```bash
git diff origin/main..HEAD -- infra/postgres/migrations/0047_users_rls_tighten.sql packages/settings/src/repository.ts
```

Confirm:
- New policy `USING(id = app.current_actor_user_id())` — no wider-than-self-row reads for jarvis_app_runtime.
- Both new functions have `SET search_path = app, pg_temp` — search-path injection hardened.
- EXECUTE is REVOKED from PUBLIC then re-granted only to jarvis_app_runtime — no over-grant.
- No secret values, tokens, or private data appear anywhere.

---

## Self-Review Against Spec

**Spec requirement → task coverage:**

| Requirement | Task |
|---|---|
| Tighten `users_app_runtime_select` to self-row | Task 2 (migration 0047) |
| Add targeted SD helpers for the real admin paths | Task 2 (get_user_by_id, list_all_users) |
| Decide count_all_users: keep (real callers exist) | Consumer audit + Task 2 comment |
| Regression test FAILS on main, PASSES on branch | Task 1 |
| Green gate before PR | Task 4 |
| No stale concepts | count_all_users retained (still used); no new dead code introduced |
| commit Co-Authored-By trailer | Every commit step |

**Placeholder scan:** None found.

**Type consistency:** `User` type from `@jarv1s/db` used consistently in `getUserById` and `listUsers`. `requireUser` uses `{ id: string }` narrowed shape — consistent with existing pattern.
