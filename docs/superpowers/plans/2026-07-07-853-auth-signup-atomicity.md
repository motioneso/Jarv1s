# Sign-up hook atomicity (#853) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **NOTE for this build:** `coordinated-build` disables the two skills above in this repo — the
> build agent executes tasks directly, one at a time, with `superpowers:test-driven-development`
> discipline (red → green → commit), not via subagent dispatch.

**Goal:** Make `bootstrapFirstJarvisUser` (`packages/auth/src/index.ts`) compensate for **any**
after-hook failure, not just the registration-disabled rejection path, so a failed sign-up never
leaves a permanently-bricked `app.users` + `auth_accounts` row behind.

**Architecture:** better-auth commits the `app.users` row (and the `auth_accounts` credential row)
on its own connection _before_ the `user.create.after` hook runs. The hook's own
`runner.withDataContext` transaction is a separate connection/transaction — rolling it back on
failure does **not** undo better-auth's insert. The existing code only ran compensating cleanup
(`deleteRejectedBootstrapRaceLoser`) when the hook explicitly threw for the
"registration disabled" reason (`registrationRejected = true`). Any _other_ failure inside the
hook's transaction — a DB error, the 0055 `users_guard_admin_flag` trigger denying a stale-admin
race (the exact scenario in the issue's live repro), a transient audit-write failure — currently
leaves the row behind with no cleanup at all, permanently bricking that email
(`USER_ALREADY_EXISTS` on every retry, `/api/bootstrap/status` stuck reporting incomplete setup).

The fix: broaden the `catch` block in `bootstrapFirstJarvisUser` so the compensating delete runs
unconditionally on **any** thrown error, while keeping the registration-rejected audit write scoped
to that one specific rejection reason (unrelated errors have no "why was this rejected" audit to
record). `app.auth_accounts` and `app.better_auth_sessions` both `REFERENCES app.users(id) ON
DELETE CASCADE` (`0004_auth_workspaces_settings.sql`), so deleting the `app.users` row alone fully
removes everything better-auth created for the failed signup — no separate `auth_accounts` delete
needed.

**0055 trigger interaction (required by the security-tier handoff):** `app.users_guard_admin_flag`
(`0055_users_guard_admin_flag_v2.sql`) denies changing `is_instance_admin` unless the actor is
already an admin OR no admin exists yet (`app.any_admin_exists()`). The exact issue repro is: a
stale `is_instance_admin = true` row survives from earlier test/dev state, but it is **not** the
bootstrap owner (`is_bootstrap_owner = false`), so `bootstrapOwnerExists()` (which checks
`is_bootstrap_owner`, not `is_instance_admin`) still returns false. A fresh sign-up then takes the
`shouldBootstrapOwner = true` branch and tries to set `is_instance_admin = true` on itself — the
trigger sees `any_admin_exists() = true` (the stale row) and `current_actor_is_admin() = false` (the
new user isn't admin yet) and raises `permission denied` (SQLSTATE 42501). This fix does not touch
the trigger or its semantics at all — it only ensures that when the trigger (or anything else in the
hook) throws, the orphaned row this signup created gets cleaned up so the email can be retried. No
migration is needed.

**Tech Stack:** TypeScript, Kysely, pg, better-auth, Vitest (integration tests against the real
Postgres container via `pnpm test:integration`).

## Global Constraints

- Never edit an already-applied migration; none is needed here.
- `DataContextDb` / `withDataContext` remains the sole transaction boundary for scoped DML — no new
  raw `appDb` writes.
- Secrets/session tokens must never reach logs — the new `logger?.warn?.()` call logs only
  `userId`/`requestId`, matching the existing pattern in this function.
- `git add` by explicit path only; do not touch `docs/coordination/`, `packages/sports/*`, or
  anything unrelated to this fix.

---

### Task 1: Reproduce the orphan bug with a failing integration test

**Files:**

- Modify: `tests/integration/auth-bootstrap-recovery.test.ts`

**Interfaces:**

- Consumes: existing test helpers in this file — `signUp(opts)`, `readUsersByEmailPrefix(prefix)`,
  `connectionStrings` from `./test-database.js`, `appDb`/`authRuntime`/`server` from the
  `beforeEach`.
- Produces: a new helper `seedStaleAdminUser(input: { id: string; email: string })` other tasks in
  this file (none in this plan) can reuse; a new `it(...)` block proving the current code leaves an
  orphan.

This reproduces the issue's exact live scenario: a stale `is_instance_admin = true` /
`is_bootstrap_owner = false` row causes the 0055 trigger to deny the new bootstrap-owner's own
`is_instance_admin` update, and (today) the failed sign-up's row is never cleaned up.

- [ ] **Step 1: Add a `seedStaleAdminUser` helper next to `seedNonBootstrapOwnerUser`**

Insert immediately after the existing `seedNonBootstrapOwnerUser` function (after its closing
`}` around line 59):

```typescript
async function seedStaleAdminUser(input: { id: string; email: string }): Promise<void> {
  const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
  await seed.connect();
  try {
    await seed.query(
      `
          INSERT INTO app.users (id, email, name, is_instance_admin, is_bootstrap_owner, status)
          VALUES ($1, $2, 'Stale Admin', true, false, 'active')
        `,
      [input.id, input.email]
    );
  } finally {
    await seed.end();
  }
}
```

- [ ] **Step 2: Write the failing test**

Add at the end of the `describe` block, after the last existing `it(...)` (after line 345, before
the closing `});` of the `describe`):

```typescript
it("deletes the orphaned row when the 0055 admin-flag guard denies bootstrap and lets retry succeed", async () => {
  // Live repro from the issue: a stale is_instance_admin=true row that is NOT the
  // bootstrap owner survives from earlier state. bootstrapOwnerExists() checks
  // is_bootstrap_owner (still false), so the new sign-up takes the
  // shouldBootstrapOwner=true branch and tries to set is_instance_admin=true on
  // itself. The 0055 trigger denies it (any_admin_exists()=true, actor not yet
  // admin) and the hook's transaction rolls back — but better-auth already
  // committed the user/account rows on its own connection before the hook ran.
  await seedStaleAdminUser({
    id: "00000000-0000-4000-8000-000000002801",
    email: "stale-admin@example.com"
  });

  const email = "bricked-owner@example.com";
  const firstAttempt = await signUp({
    name: "Bricked Owner",
    email,
    password: "password12345"
  });

  expect(firstAttempt.statusCode).not.toBe(200);

  // The failed attempt's row must not survive — otherwise the email is
  // permanently taken with no way to complete setup.
  const afterFailure = await readUsersByEmailPrefix("bricked-owner@");
  expect(afterFailure).toHaveLength(0);

  // Retrying the exact same email must succeed now that the row was cleaned up.
  const retry = await signUp({
    name: "Bricked Owner",
    email,
    password: "password12345"
  });
  expect(retry.statusCode).toBe(200);
});
```

- [ ] **Step 3: Run the test and confirm it fails the way the issue describes**

Run: `pnpm exec vitest run tests/integration/auth-bootstrap-recovery.test.ts -t "0055 admin-flag guard"`

Expected: FAIL. The `afterFailure` row-count assertion should fail (`expected 0 to be 1`, or similar) —
proving the orphaned row survives today, matching the issue. If instead the _first_ `signUp` call
unexpectedly returns 200, stop and re-check the seed data / trigger logic before continuing (the
repro premise would be wrong).

- [ ] **Step 4: Commit the failing test**

```bash
git add tests/integration/auth-bootstrap-recovery.test.ts
git commit -m "test(auth): reproduce #853 orphaned bootstrap row on 0055 trigger denial"
```

---

### Task 2: Make cleanup run on any hook failure, not just registration-rejected

**Files:**

- Modify: `packages/auth/src/index.ts:464-577` (the `bootstrapFirstJarvisUser` catch block and the
  `deleteRejectedBootstrapRaceLoser` helper)

**Interfaces:**

- Consumes: existing `recordRegistrationRejectedAudit(runner, settings, userId)`,
  `authPool: pg.Pool`, `logger?: AuthLogger` — all already in scope in this function.
- Produces: renamed helper `deleteOrphanedBootstrapUser(authPool: pg.Pool, userId: string):
Promise<void>` (was `deleteRejectedBootstrapRaceLoser`) — no other file references the old name
  (verified: it is only called from within this same function).

- [ ] **Step 1: Replace the `catch` block in `bootstrapFirstJarvisUser`**

Replace this block (currently lines 539–554):

```typescript
  } catch (err) {
    if (registrationRejected) {
      try {
        await recordRegistrationRejectedAudit(runner, settings, user.id);
      } catch {
        // Audit is best-effort on the reject path — do not mask the original error.
        logger?.warn?.(
          { userId: user.id, requestId: `bootstrap-reject:${user.id}` },
          "[auth] registration-rejected audit write failed"
        );
      } finally {
        await deleteRejectedBootstrapRaceLoser(authPool, user.id);
      }
    }
    throw err;
  }
```

with:

```typescript
  } catch (err) {
    // better-auth commits the app.users row (and any auth_accounts/session rows)
    // on its OWN connection before this after-hook runs, so this transaction
    // rolling back does NOT undo that insert. ANY hook failure — registration
    // disabled, the 0055 admin-flag guard denying a stale-admin race, a
    // transient audit-write error, anything — must compensate by deleting the
    // row here, or the email is permanently bricked: USER_ALREADY_EXISTS on
    // every retry with no way to complete setup (#853).
    if (registrationRejected) {
      try {
        await recordRegistrationRejectedAudit(runner, settings, user.id);
      } catch {
        // Audit is best-effort on the reject path — do not mask the original error.
        logger?.warn?.(
          { userId: user.id, requestId: `bootstrap-reject:${user.id}` },
          "[auth] registration-rejected audit write failed"
        );
      }
    }
    try {
      await deleteOrphanedBootstrapUser(authPool, user.id);
    } catch {
      // Best-effort compensation — do not mask the original error with a
      // cleanup failure; the original `err` below is what the caller sees.
      logger?.warn?.(
        { userId: user.id, requestId: `bootstrap:${user.id}` },
        "[auth] failed to delete orphaned better-auth user after bootstrap hook failure"
      );
    }
    throw err;
  }
```

- [ ] **Step 2: Rename and re-document the delete helper**

Replace this function (currently lines 575–577):

```typescript
async function deleteRejectedBootstrapRaceLoser(authPool: pg.Pool, userId: string): Promise<void> {
  await authPool.query("DELETE FROM app.users WHERE id = $1", [userId]);
}
```

with:

```typescript
// Compensating delete for any bootstrap after-hook failure (#853). app.auth_accounts
// and app.better_auth_sessions both FK user_id ON DELETE CASCADE
// (0004_auth_workspaces_settings.sql), so deleting the app.users row alone fully
// removes the credential + session rows better-auth committed for this signup —
// no separate auth_accounts delete is needed.
async function deleteOrphanedBootstrapUser(authPool: pg.Pool, userId: string): Promise<void> {
  await authPool.query("DELETE FROM app.users WHERE id = $1", [userId]);
}
```

- [ ] **Step 3: Run the new test and confirm it passes**

Run: `pnpm exec vitest run tests/integration/auth-bootstrap-recovery.test.ts -t "0055 admin-flag guard"`

Expected: PASS.

- [ ] **Step 4: If the first assertion (`not.toBe(200)`) needs pinning, inspect the actual status
      code and tighten the test**

Run: `pnpm exec vitest run tests/integration/auth-bootstrap-recovery.test.ts -t "0055 admin-flag guard" --reporter=verbose`

If the response body/status code is stable and meaningful (e.g. `500`), tighten
`expect(firstAttempt.statusCode).not.toBe(200)` to the exact code observed, so the test also catches
a regression where the error stops propagating correctly. Skip this step only if the code is
non-deterministic between runs.

- [ ] **Step 5: Run the full existing file to confirm no regression**

Run: `pnpm exec vitest run tests/integration/auth-bootstrap-recovery.test.ts`

Expected: PASS — all 5 tests (4 existing + 1 new) green. This specifically confirms the
"deletes race-loser row and returns 403" test (registration-rejected path) still passes unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/index.ts
git commit -m "fix(auth): compensate for any bootstrap hook failure, not just registration-disabled

Any bootstrap after-hook failure (0055 admin-flag guard denial, transient
audit-write error, etc.) left the better-auth user/account rows committed
with no cleanup, permanently bricking the email (#853)."
```

---

### Task 3: Full local gate

**Files:** none (verification only).

- [ ] **Step 1: Run the pre-push trio**

Run: `pnpm format:check && pnpm lint && pnpm typecheck`

Expected: all exit 0.

- [ ] **Step 2: Run the full integration suite**

Run: `pnpm test:integration`

Expected: exit 0, no regressions outside this file.

- [ ] **Step 3: Rebase on latest main**

Run: `git fetch origin main && git rebase origin/main`

Expected: clean rebase (no conflicts expected — this PR only touches `packages/auth/src/index.ts`
and `tests/integration/auth-bootstrap-recovery.test.ts`).

## Exit Criteria

- New test reproduces the exact issue scenario (0055 trigger denial during bootstrap-owner
  self-promotion) and passes.
- `bootstrapFirstJarvisUser` deletes the orphaned `app.users` row on **any** after-hook failure, not
  only the registration-disabled path.
- All 5 tests in `auth-bootstrap-recovery.test.ts` pass, including the pre-existing
  registration-rejected race-loser test (unchanged behavior).
- Full local gate (`format:check`, `lint`, `typecheck`, `test:integration`) is green.
- No migration added; no changes to `packages/sports/*` or `docs/coordination/`.
