# Relay — settings-ui-scanner: reject shell-reserved path collisions (#835)

**Original handoff (source of truth for run context):** lives only on the unmerged
`coord/settings-host-cleanup` branch at commit `c171786e`, path
`docs/coordination/handoffs/2026-07-06-835-scanner-reserved-paths.md` — not present on this
branch/worktree. Read it via `git show c171786e:docs/coordination/handoffs/2026-07-06-835-scanner-reserved-paths.md`
if you need the full original text (issue link, worktree/branch, coordinator label/session id,
run-specific bans, collision notes). Key facts repeated below so you don't have to fetch it.

**Issue:** #835 — settings-ui scanner: reject module web routes colliding with shell-reserved paths
**Spec:** `docs/superpowers/specs/2026-07-04-module-web-registry.md` (approved/implemented)
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/835-scanner-reserved-paths`
**Branch:** `835-scanner-reserved-paths` off `origin/main` @ `616b9ed1`
**Coordinator label:** `Coordinator` — resolve fresh via `herdr pane list` (exactly one pane must
hold this label; never trust a cached pane number). Session id at last check:
`6b766f7c-577d-4e32-b5b8-b441e6788036` (re-verify, don't assume — session ids persist across pane
renumbering but always confirm via `herdr pane list` before messaging).

## Status

**Plan approved by coordinator.** No code written yet — proceed straight to Task 1.

- Plan: `docs/superpowers/plans/2026-07-06-scanner-reserved-paths.md` — READ IN FULL, it has exact
  code for both tasks.
- Spec premise verified current against this branch (2026-07-06): `scanModuleWeb` in
  `packages/settings-ui/src/scanner.ts` has no shell-reserved-path check yet; `webRoutes` in
  `apps/web/src/app-route-metadata.ts` hardcodes exactly 6 shell paths (today, tasks, notifications,
  calendar, wellness, settings) plus the module-contributed spread (`MODULE_WEB_ROUTES`, currently
  just `sports`). No drift since the plan was written.
- No commits made on this branch yet. Working tree has only the plan file (this doc will add one
  more) — nothing else in flight.

## Next steps (in order)

1. `[ -d node_modules ] || pnpm install` (should already exist).
2. Read `docs/superpowers/plans/2026-07-06-scanner-reserved-paths.md` IN FULL.
3. Resume via `coordinated-build` step 2 (Build) — plan is already approved, skip straight to TDD
   execution of Task 1 then Task 2. Drive it yourself task-by-task (execution skills disabled in
   this repo).
4. After both tasks pass and full existing suites are green (plan's Step 5 in Task 2), run the
   pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`, rebase on `origin/main`), then
   `coordinated-wrap-up` (PR + report to coordinator). Do not merge, touch the board, or touch
   `docs/coordination/`.

## Run-specific bans (unchanged, from original handoff)

- Work only in this worktree/branch; `git add` explicit paths only, never `-A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the board, milestones, or merge.
- No secrets in any doc/payload/log/prompt.
- Ownership confirmed: you own `packages/settings-ui/src/scanner.ts` and
  `apps/web/src/app-route-metadata.ts` (read-only reference for the drift test, no edits needed to
  this file) for this run. #834/#832/#833/#836/#837 are disjoint — no overlap.

## Relay history

- 2026-07-06: first build session relayed at context-meter 70% warning right after plan approval,
  before any code was written. This doc is that relay's handoff.
