# Owner Bootstrap Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the next signup become active bootstrap owner/admin when no bootstrap owner exists, even if the database already contains non-owner users.

**Architecture:** Keep `bootstrapFirstJarvisUser` inside the existing `DataContextRunner.withDataContext` transaction and advisory lock. Replace the `count_all_users() === 1` decision with a boolean "bootstrap owner exists" read using the existing `app.list_all_users()` SECURITY DEFINER helper, avoiding a new migration while still bypassing self-row RLS for this pre-auth bootstrap check.

**Tech Stack:** TypeScript, Kysely SQL tagged templates, Fastify injection integration tests, Vitest, PostgreSQL RLS/security-definer helpers.

---

## File Structure

- Modify `packages/auth/src/index.ts`
  - Add a small `bootstrapOwnerExists(appDb)` helper near `readBooleanSetting`.
  - Update `bootstrapFirstJarvisUser` to compute `shouldBootstrapOwner = !(await bootstrapOwnerExists(scopedDb.db))`.
  - Preserve advisory transaction lock, `withDataContext`, status logic, update statement, and bootstrap audit event.
- Modify `tests/integration/auth-settings.test.ts`
  - Add one focused integration test in `multi-user registration + lifecycle (Phase 2 Slice A)` for non-empty/no-owner recovery under `registration.requires_approval=true`.
  - Seed a non-admin, non-bootstrap-owner user via bootstrap connection, then sign up a new user and assert active/admin/bootstrap-owner plus audit event.
  - Keep existing first-signup and later-pending tests as regression coverage.

No migration planned. If implementation proves `app.list_all_users()` cannot be used from `jarvis_app_runtime`, stop and escalate before adding any new SQL migration.

---

### Task 1: Add Failing Recovery Integration Test

**Files:**

- Modify: `tests/integration/auth-settings.test.ts`

- [x] **Step 1: Add the failing test**

Insert this test after `marks the first sign-up as bootstrap owner with active status` and before `marks subsequent sign-up as pending when requires_approval is true`:

```typescript
it("bootstraps signup as owner when existing users have no bootstrap owner", async () => {
  const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
  await seed.connect();
  try {
    await seed.query(
      `
          INSERT INTO app.users (id, email, name, is_instance_admin, is_bootstrap_owner, status)
          VALUES (
            '00000000-0000-4000-8000-000000002601',
            'seeded-non-owner@example.com',
            'Seeded Non Owner',
            false,
            false,
            'active'
          )
        `
    );
  } finally {
    await seed.end();
  }

  const signUpRes = await signUp({
    name: "Recovered Owner",
    email: "recovered-owner@example.com",
    password: "password12345"
  });
  expect(signUpRes.statusCode).toBe(200);
  const recoveredOwnerId = signUpRes.json<{ user: { id: string } }>().user.id;

  const rows = await sql<{
    is_instance_admin: boolean;
    is_bootstrap_owner: boolean;
    status: string;
  }>`SELECT is_instance_admin, is_bootstrap_owner, status FROM app.get_user_by_id(${recoveredOwnerId}::uuid)`.execute(
    appDb
  );

  expect(rows.rows[0]).toMatchObject({
    is_instance_admin: true,
    is_bootstrap_owner: true,
    status: "active"
  });

  const audit = new pg.Client({ connectionString: connectionStrings.bootstrap });
  await audit.connect();
  try {
    const auditRows = await audit.query<{ count: string }>(
      `
          SELECT count(*)::text AS count
          FROM app.admin_audit_events
          WHERE action = 'bootstrap_owner_created'
            AND actor_user_id = $1
            AND target_id = $1
        `,
      [recoveredOwnerId]
    );
    expect(Number(auditRows.rows[0]?.count ?? 0)).toBe(1);
  } finally {
    await audit.end();
  }
});
```

- [x] **Step 2: Run test to verify it fails**

Run with lane-specific DB:

```bash
JARVIS_PGDATABASE=jarvis_build_owner260 pnpm db:up
JARVIS_PGDATABASE=jarvis_build_owner260 pnpm db:migrate
JARVIS_PGDATABASE=jarvis_build_owner260 pnpm vitest run tests/integration/auth-settings.test.ts -t "bootstraps signup as owner when existing users have no bootstrap owner"
```

Expected: FAIL because current code treats `count_all_users() === 2` as not-first-user, reads `registration.requires_approval=true`, and leaves recovered signup pending/non-owner.

Do not commit this red state.

---

### Task 2: Replace Row-Count Bootstrap Decision

**Files:**

- Modify: `packages/auth/src/index.ts`
- Test: `tests/integration/auth-settings.test.ts`

- [x] **Step 1: Add owner-existence helper**

Add this helper after `readBooleanSetting`:

```typescript
async function bootstrapOwnerExists(appDb: Kysely<JarvisDatabase>): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM app.list_all_users()
      WHERE is_bootstrap_owner = true
    ) AS "exists"
  `.execute(appDb);

  return result.rows[0]?.exists ?? false;
}
```

- [x] **Step 2: Update `bootstrapFirstJarvisUser`**

Replace this block:

```typescript
      // app.count_all_users() is a SECURITY DEFINER function owned by jarvis_auth_runtime,
      // which has a USING(true) policy on users under FORCE RLS. This gives an accurate
      // total count even though app_runtime's own self-row policy would return count=1.
      const countResult = await sql<{
        count: string;
      }>`SELECT app.count_all_users() AS count`.execute(scopedDb.db);
      const isFirstUser = Number(countResult.rows[0]?.count ?? 0) === 1;

      let status: "active" | "pending" = "active";
      if (!isFirstUser) {
```

with:

```typescript
      // Use the existing SECURITY DEFINER all-users read helper here. A direct
      // app.users query under app_runtime would be RLS-scoped to the signup's own row
      // and would miss an existing bootstrap owner.
      const shouldBootstrapOwner = !(await bootstrapOwnerExists(scopedDb.db));

      let status: "active" | "pending" = "active";
      if (!shouldBootstrapOwner) {
```

Then replace all remaining `isFirstUser` uses in this function with `shouldBootstrapOwner`:

```typescript
          is_instance_admin: shouldBootstrapOwner,
          is_bootstrap_owner: shouldBootstrapOwner,
```

and:

```typescript
if (!shouldBootstrapOwner) {
  return;
}
```

- [x] **Step 3: Run focused recovery test**

```bash
JARVIS_PGDATABASE=jarvis_build_owner260 pnpm vitest run tests/integration/auth-settings.test.ts -t "bootstraps signup as owner when existing users have no bootstrap owner"
```

Expected: PASS.

- [x] **Step 4: Run auth lifecycle regression tests**

```bash
JARVIS_PGDATABASE=jarvis_build_owner260 pnpm vitest run tests/integration/auth-settings.test.ts
```

Expected: PASS. This covers empty DB first signup, later pending signup when a bootstrap owner exists, pending-user access denial, admin lifecycle, and bootstrap audit behavior.

- [x] **Step 5: Commit focused code/test change**

```bash
git add packages/auth/src/index.ts tests/integration/auth-settings.test.ts
git commit -m "fix: recover bootstrap owner signup"
```

Commit body:

```text
Co-Authored-By: Claude
```

---

### Task 3: Security-Tier Verification

**Files:**

- No file changes expected.

- [x] **Step 1: Run maintainability checks**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all PASS.

- [x] **Step 2: Run full foundation gate with lane DB**

```bash
JARVIS_PGDATABASE=jarvis_build_owner260 pnpm verify:foundation
```

Expected: PASS.

- [x] **Step 3: Run release hardening audit**

```bash
JARVIS_PGDATABASE=jarvis_build_owner260 pnpm audit:release-hardening
```

Expected: PASS.

- [x] **Step 4: Capture final state**

```bash
git status --short
git log -1 --oneline
```

Expected: working tree clean except allowed pre-existing untracked files noted in handoff; latest commit is `fix: recover bootstrap owner signup`.

---

## Self-Review

- Spec coverage:
  - Non-empty DB with no owner: Task 1 adds focused failing test.
  - No literal empty-row-count owner decision: Task 2 removes `count_all_users() === 1` from bootstrap decision.
  - Advisory lock retained: Task 2 changes only decision code inside existing locked transaction.
  - `withDataContext` retained: Task 2 keeps current transaction/GUC boundary.
  - Audit retained: Task 1 asserts audit for recovery owner; Task 2 preserves audit call under `shouldBootstrapOwner`.
  - Existing later-user pending behavior: Task 2 regression run covers current test `marks subsequent sign-up as pending when requires_approval is true`.
  - Empty DB first signup: Task 2 regression run covers current test `marks the first sign-up as bootstrap owner with active status`.
  - No migration: plan uses existing `app.list_all_users()` helper; escalation required if that assumption fails.
- Placeholder scan: no TBD/TODO/fill-in steps remain.
- Type consistency:
  - `bootstrapOwnerExists(appDb: Kysely<JarvisDatabase>): Promise<boolean>` matches existing helper style.
  - `shouldBootstrapOwner` boolean replaces every local `isFirstUser` use in `bootstrapFirstJarvisUser`.
  - Test uses already imported `pg`, `sql`, `connectionStrings`, and `appDb`; audit-table read uses bootstrap connection because normal app runtime SELECT is admin-gated by RLS.
