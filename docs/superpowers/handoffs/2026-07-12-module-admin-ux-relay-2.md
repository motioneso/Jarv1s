# Relay 2 — module-management admin UX (#996, part of #860)

Worktree/branch: `/home/ben/Jarv1s/.claude/worktrees/module-admin-ux`, branch `module-admin-ux`.
Coordinator label: `Coordinator` — confirm still exactly one pane with this label
(`herdr pane list`) before escalating.

## State

- **Plan APPROVED by Coordinator** (2026-07-12): `docs/superpowers/plans/2026-07-12-module-management-admin-ux.md`
  — 13 TDD tasks (S1 gate removal + resolveModulesDir, S2 manifest flip, S3 pane dedup+switch, S4
  compose) + Task 14 (full gate + PR). Read it BY TASK, never in full.
- Coordinator's two explicit confirms to honor while building (do not skip):
  1. Task 11 must actually DELETE `USER_TOGGLEABLE_MODULE_IDS` and derive from `!module.required`.
  2. Keep the existing `pending-restart` state/tag verbatim in the registry pane — no auto-reboot.
- **Currently in progress: Task 1** (`resolveModulesDir` helper, task list id `1` — see `TaskList`).
  - Written and confirmed FAILING: `tests/unit/resolve-modules-dir.test.ts` (uncommitted, on disk).
  - NOT yet written: `packages/module-registry/src/resolve-modules-dir.ts` (the implementation —
    exact code is in the plan doc's Task 1 Step 3) and the `export * from "./resolve-modules-dir.js";`
    line to add to `packages/module-registry/src/node.ts`.
  - **Zero commits made this build session** — nothing to lose, just pick up at Task 1 Step 3.
- Tasks 2-14 not started (task-tracker ids 2-14, all `pending`).
- No PLAN-996.md/BRIEF-996.md changes needed anymore — both superseded by the approved plan doc.

## Next steps

1. `[ -d node_modules ] || pnpm install` (should already exist — skip).
2. Read `docs/superpowers/plans/2026-07-12-module-management-admin-ux.md`'s **Task 1** section
   only. Write the implementation (Step 3), run the test (Step 4 — expect PASS), commit (Step 5).
3. Continue Task 2 → Task 13 in order, one plan-doc section at a time, TDD (`superpowers:test-driven-development`),
   one green commit per task, `Co-Authored-By: Claude` trailer, generous why-comments citing
   `#996`/`#860`. Mark each TaskUpdate `in_progress`→`completed` as you go (`TaskList` shows ids 1-14).
4. Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck` +
   `git fetch origin main && git rebase origin/main`.
5. Task 14: full gate `pnpm verify:foundation` + `pnpm test:integration`, both green, record exit
   codes, then `coordinated-wrap-up` — PR body `Part of #996` + `Part of #860`, base `main`, short
   user-facing "What's new" line. Report PR number to Coordinator. Never merge/board/close.

## Constraints (unchanged)

- Never touch `packages/ai/**`, `packages/chat/**`, `packages/module-registry/src/index.ts`,
  AI-admin settings surfaces (Codex-869's lane, concurrent build on `ai-admin-869`).
- No DB migration for S2 (confirmed unnecessary, Coordinator re-confirmed).
- No `git add -A`. Don't touch `docs/coordination/`. Don't run repo-wide `pnpm format`. Never edit
  an applied migration.
- S4 (compose) is repo-side only — never touch `~/JarvisProd/` or any live box.

## Why relaying now

Context-meter hit 71% mid-Task-1, right after confirming the new test fails as expected (before
writing the implementation). Clean, low-loss handoff point — pick up at Step 3 of Task 1.
