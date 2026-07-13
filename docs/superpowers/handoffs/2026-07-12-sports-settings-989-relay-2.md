# Relay 2 — #989 Sports settings dogfood hardening

**Worktree:** `~/Jarv1s/.claude/worktrees/ux-989-sports-settings-build` (already checked out — do NOT re-clone, do NOT `pnpm install`, `node_modules` present)
**Branch:** `ux/989-sports-settings-build`
**Plan:** `docs/superpowers/plans/2026-07-12-sports-settings-dogfood-hardening.md` — **PLAN ALREADY APPROVED by coordinator, no fork, no re-send.**
**Build skill:** `coordinated-build` (this repo's `.claude/skills/coordinated-build/SKILL.md`)
**Supervising coordinator:** label `UX Coordinator` — **re-resolve session id fresh via `herdr pane list` before messaging, do not trust any id written here.**

## Status: Task 1 DONE (commit `827d37fe`). Resume at Task 2.

## What's done
- Task 1 committed `827d37fe`: `followControlState` + `pendingDirectionFor` + `FollowActionState`
  type added to `packages/sports/src/settings/index.tsx`; team + whole-league buttons in both
  `SearchResults` and `BrowseGroups` rewritten with `aria-pressed` + truthful labels;
  `FollowedSummary`'s remove button now uses `pendingDirectionFor`. Test file
  `tests/unit/settings-sports-pane.test.tsx` has a new `followControlState` describe block (6
  tests) and all `pending: false` call sites in the `is-active styling coverage` / `BrowseGroups`
  describes were stubbed to `actionState: null` (per plan Task 1 Step 4 guidance — this is
  intentional, not a hack to revert).
- `pnpm vitest run tests/unit/settings-sports-pane.test.tsx` → 24/24 PASS.
- **Known, expected, deliberate:** `pnpm typecheck` is currently RED. `SportsSettings`'s own
  render body still passes the old `pending={pending}` / 2-arg `onToggle` to `FollowedSummary`/
  `SearchResults`/`BrowseGroups`, which now expect `actionState`/3-arg `onToggle`. This is called
  out explicitly in the plan (Task 1 Step 4 note: "production wiring lands in Task 2"). **Do not
  "fix" this before Task 2 — Task 2 IS the fix.**
- Coordinator notified of Task 1 completion + this relay (message sent, may still be queued — it
  was busy).

## What's next — resume here

1. Re-resolve pane fresh via `herdr pane list`; message `UX Coordinator` your new pane
   label + `agent_session.value` (one line, caveman), confirming you're driving Task 2.
2. Read plan Task 2 only (`docs/superpowers/plans/2026-07-12-sports-settings-dogfood-hardening.md`,
   "### Task 2: Wire `actionState` into `SportsSettings`") — do not re-read the whole plan/spec.
3. TDD per `superpowers:test-driven-development`: write the failing test (target-named error copy
   replaces generic banner), verify fail, implement (`actionState` state + `toggle()` rewrite +
   error `<Note>` split into load-error vs action-error), verify pass, `pnpm typecheck` must be
   clean (Task 2 Step 5 — this is the point where Task 1's known-red typecheck resolves), commit.
4. Continue Tasks 3–6 task-by-task, same TDD discipline, committing green per task, staging only
   each task's own files (never `git add -A`).
5. Stay inside the 4 locked paths: `packages/sports/src/settings/index.tsx`,
   `packages/sports/src/settings/sports-2.css`, `tests/unit/settings-sports-pane.test.tsx`,
   `tests/e2e/sports-settings.spec.ts`. No shell/routes/service/repository/SQL edits.
6. Pre-push trio before any push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
7. On all 6 tasks + exit-criteria walkthrough done: invoke `coordinated-wrap-up` (gate, push, PR,
   report to coordinator). Never merge/board/touch `docs/coordination/`.
8. Relay again yourself on the next 70% warning/compaction — same procedure.

## Predecessor session (safe to reap once you confirm driving)
Resolve fresh by label — do not trust a baked-in id/pane number here (they reflow). Ask the
coordinator to reap the pane that just relayed you if it doesn't already know.
