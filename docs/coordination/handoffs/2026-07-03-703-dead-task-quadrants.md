# Build Handoff — 703 dead task quadrants

**Spec (approved):** GitHub issue #703
**GitHub issue:** #703
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/703-dead-task-quadrants` **Branch:** `coord/703-dead-task-quadrants` off current green `origin/main`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f25f9-9b63-76f3-9505-a015196d4a41`
**Relay threshold:** ~80-100k tokens or compaction summary.

## Source

Issue #703 from `docs/audits/2026-07-02-dead-code-audit.md` added by commit `9cc00803`.

## Scope

Remove these dead functions from `packages/tasks/src/classification.ts` after re-confirming zero callers on current `origin/main`:

- `classifyTaskQuadrant`
- `isTaskImportant`
- `isTaskUrgent`

Current Eisenhower behavior lives in SQL in `TasksRepository`. When deleting these doc-like helpers, update the related `repository.ts` comment and any file doc-comment so the SQL behavior remains understandable.

## Required Flow

1. `[ -d node_modules ] || pnpm install`.
2. Read AGENTS.md, CLAUDE.md, this handoff, and the coordinated-build skill.
3. Re-confirm zero callers and identify any still-live shared constants.
4. Submit a compact plan for coordinator approval before code.
5. Keep any re-exported shared constants that are still used.
6. Run focused tasks tests plus typecheck; include exact commands and exits in wrap-up.

## Collision Notes

Wave 1 is parallel-safe with #701, #702, #707, and #708. Do not touch `docs/coordination/` from the build branch. Use explicit staging only.
