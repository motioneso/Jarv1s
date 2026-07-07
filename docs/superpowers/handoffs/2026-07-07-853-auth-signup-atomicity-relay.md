# Relay handoff — #853 sign-up hook atomicity

**Worktree/branch:** `/home/ben/Jarv1s/.claude/worktrees/853-auth-signup-atomicity`, branch
`853-auth-signup-atomicity` (off `origin/main @ babe07aa`).
**Handoff doc (read first, has coordinator label/session):**
`docs/coordination/handoff-853-auth-signup-atomicity.md`
**Plan (approved by coordinator, followed exactly):**
`docs/superpowers/plans/2026-07-07-853-auth-signup-atomicity.md`
**Risk tier:** `security` — Opus adversarial QA + mandatory Ben sign-off before merge (handoff doc
step, not yours to do).

## Done (all plan Tasks 1 + 2, both committed)

- `77ac5adf` — test(auth): reproduce #853 orphaned bootstrap row on 0055 trigger denial
- `d9680e21` — fix(auth): compensate for any bootstrap hook failure, not just registration-disabled
  (includes the tightened test assertions — see below)

Root cause (confirmed, verified against a real error in a live test run): better-auth commits the
`app.users` row + `auth_accounts` credential row on its **own connection** before the
`user.create.after` hook (`bootstrapFirstJarvisUser`) runs. That hook's own
`runner.withDataContext` transaction rolling back does **not** undo better-auth's insert. The old
code only ran compensating cleanup (`deleteRejectedBootstrapRaceLoser`) when the hook explicitly
threw for the "registration disabled" reason. Any other failure — critically the 0055
`users_guard_admin_flag` trigger denying a stale-admin race (the issue's exact live repro) — left
the row behind with zero cleanup, permanently bricking the email.

Fix in `packages/auth/src/index.ts`:
- The `catch` block in `bootstrapFirstJarvisUser` now **always** calls the renamed
  `deleteOrphanedBootstrapUser(authPool, user.id)` (was `deleteRejectedBootstrapRaceLoser`),
  regardless of `registrationRejected`. The registration-rejected audit write is still scoped to
  that one specific reason (unrelated errors have no "why rejected" to record).
- `deleteOrphanedBootstrapUser` is unchanged in body (`DELETE FROM app.users WHERE id = $1`) — a
  doc comment now explains the `ON DELETE CASCADE` FKs (`auth_accounts`, `better_auth_sessions` →
  `app.users(id)`, from `0004_auth_workspaces_settings.sql`) mean this one delete fully cleans up
  everything better-auth committed.
- No migration added; the 0055 trigger itself is untouched, per the security-tier requirement in
  the handoff doc.

Test: `tests/integration/auth-bootstrap-recovery.test.ts` — new `it(...)` "deletes the orphaned row
when the 0055 admin-flag guard denies bootstrap and lets retry succeed":
1. Seeds a stale `is_instance_admin=true`/`is_bootstrap_owner=false` user (`seedStaleAdminUser`
   helper, added next to `seedNonBootstrapOwnerUser`) — the exact issue repro condition.
2. First sign-up attempt for a fresh email hits the `shouldBootstrapOwner=true` branch, the 0055
   trigger denies it → asserts `statusCode === 500` (verified empirically, not guessed — better-auth
   surfaces the raw Postgres `42501` as a 500, not the `422 USER_ALREADY_EXISTS` the issue describes
   on *subsequent* attempts against a bricked row).
3. Asserts the failed row is gone (`readUsersByEmailPrefix` → length 0) — this is the actual
   regression check; it failed (`length 1`) before the fix, passes after.
4. Remediates the stale-admin blocker directly via SQL (simulating an operator fixing the real
   conflict — a separate concern from this fix) and asserts the retry with the **same email**
   succeeds (`200`), proving the email was never permanently bricked.

All 5 tests in the file pass (`pnpm exec vitest run tests/integration/auth-bootstrap-recovery.test.ts`
→ 5 passed, verified locally against the live shared dev Postgres, migrations already current).

## Left to do (plan Task 3 + `coordinated-wrap-up`)

1. Run the pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck` — not yet run this
   session, do it first.
2. Run the full integration suite: `pnpm test:integration` — only the one file has been run in
   isolation so far; confirm no regressions elsewhere (unrelated to this change, but required by
   the gate).
3. `git fetch origin main && git rebase origin/main` — no conflicts expected, this PR only touches
   `packages/auth/src/index.ts` and `tests/integration/auth-bootstrap-recovery.test.ts`.
4. Invoke `coordinated-wrap-up`: clean tree, push, open PR, report the PR + verified evidence to
   the coordinator. **Do not merge, touch the board, or close the issue** — that's the coordinator's
   gate (Opus adversarial QA + Ben sign-off, per the handoff doc).

## Coordinator

- **Label:** `Coordinator` — resolve fresh via `herdr pane list`, confirm exactly one pane holds
  that label, before messaging (never a cached `…-N` number).
- **Session id (authority):** `e56b7c36-6f1b-4438-85ef-bb5cad9eed74`
- Plan was already approved by the coordinator this session (verbatim: "Plan approved as
  written... Proceed with TDD as planned.") — no need to re-request plan approval, just continue
  and report at wrap-up.

## Notes for successor

- `node_modules` already installed in this worktree — skip `pnpm install`.
- `pg` (`node-postgres`) is already imported in the test file for the bootstrap-connection seed
  helpers — reuse the existing `connectionStrings.bootstrap` pattern, don't invent a new one.
- Untracked files present and intentional, do not delete: `.claude/context-meter.log` (harness
  artifact), this handoff doc itself, and the plan doc under `docs/superpowers/plans/`.
- Caveman/terse mode to the coordinator per `coordinated-build`; normal prose in commits/PR body.
