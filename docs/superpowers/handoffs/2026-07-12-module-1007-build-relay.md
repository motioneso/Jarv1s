# Relay — module-persist-1006 build (#1007 fix + Stage 2 UAT), mid-Task-1

Worktree: `/home/ben/Jarv1s/.claude/worktrees/module-persist-1006`, branch `module-persist-1006`.
`node_modules` present — **skip `pnpm install`**. Coordinator label: `Coordinator` (re-resolve
fresh via `herdr pane list`, never reuse a cached `…-N`). Skill: `coordinated-build`. Tier:
**security**.

## Plan (APPROVED by Coordinator — do not re-litigate, do not re-plan)

`docs/superpowers/plans/2026-07-12-module-1007-enoent-guard-and-uat-proof.md` — 6 tasks. Read it
by SECTION for the task you're resuming, not front-to-back.

## Coordinator's approval reinforced these (binding, unchanged):

- Task 3 stack MUST be **built from this worktree**, not `:edge` pulled — the #1007 fix is
  unpublished.
- Isolated stack `jarvis-uat-1006` only; PROD `jarv1s-prod:1533` and `jarvis-devproof-999`
  untouched.
- Do NOT edit any Instance-modules/settings UI code — drive-only via Playwright.
- **New from Coordinator mid-build:** concurrent UX wave-2 (#986) is now editing
  `settings-admin-panes.tsx`, `settings-page.tsx`, and shared Playwright fixtures/selectors. Keep
  `scripts/uat/job-search-install.spec.ts` **fully self-contained** — do NOT import any shared
  settings Playwright fixture/selector module. (Already true of the script as planned — it only
  imports from `playwright` directly, all selectors inlined from source reads. No action needed,
  just don't regress this.)
- No `git add -A`, no `docs/coordination/` edits.

## State right now

- Task 1 (ENOENT guard, TDD) **in progress, uncommitted**:
  - `tests/integration/module-migration-ledger.test.ts` — 3rd test added to the
    `describe("loadModuleMigrationFiles", ...)` block ("returns [] when the directory doesn't
    exist"). **Written, NOT yet confirmed failing** — a background run
    (`pnpm test:integration -- tests/integration/module-migration-ledger.test.ts`) was still
    running when this relay fired (dev Postgres `jarv1s-postgres` on `localhost:55433` is up;
    isolated-DB-per-run mode, can be slow — budget 3+ min, don't assume a hang under ~5 min).
  - `packages/db/src/migrations/module-sql-runner.ts` — **NOT yet edited** (the fix itself, plan
    Task 1 Step 3, is still to do).
- Nothing committed yet this build session. `git status --short` should show only: the test-file
  edit above, `.claude/context-meter.log` (ignore, pre-existing), and the plan doc (untracked,
  already committed? — check; if untracked, it's fine to leave uncommitted, it's docs not code).

## Next steps for successor (in order)

1. Re-run `pnpm test:integration -- tests/integration/module-migration-ledger.test.ts` fresh
   (previous run's outcome is unknown — don't trust a stale background task from a prior
   session). Confirm the new test currently **fails** (raw ENOENT), per plan Task 1 Step 2.
2. Implement plan Task 1 Step 3 exactly as written in the plan doc (try/catch around `readdir` in
   `loadModuleMigrationFiles`, `packages/db/src/migrations/module-sql-runner.ts:130-146`, return
   `[]` on `ENOENT`, rethrow otherwise, generous why-comment citing #1007).
3. Re-run the same test file, confirm all 3 tests in `describe("loadModuleMigrationFiles", ...)`
   pass plus the untouched `describe("module migration ledger", ...)` block.
4. `git add packages/db/src/migrations/module-sql-runner.ts
   tests/integration/module-migration-ledger.test.ts` (explicit paths, never `-A`) and commit per
   plan Task 1 Step 5.
5. Continue with plan Tasks 2–6 in order (full gate → isolated UAT stack build-from-worktree →
   Playwright script → restart/recreate persistence proof → pre-push/PR/report via
   `coordinated-wrap-up`).
6. Self-monitor context; relay again on the 70% meter warning or a compaction summary, same as
   this relay.

## Escalation

Message `Coordinator` (fresh-resolved) once this relay's successor is confirmed driving: "relayed
to <successor pane/label>, safe to reap me." Coordinator kills this session's pane.
