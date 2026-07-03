# Build Handoff — 707 dead DB aliases

**Spec (approved):** GitHub issue #707
**GitHub issue:** #707
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/707-dead-db-aliases` **Branch:** `coord/707-dead-db-aliases` off current green `origin/main`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f25f9-9b63-76f3-9505-a015196d4a41`
**Relay threshold:** ~80-100k tokens or compaction summary.

## Source

Issue #707 from `docs/audits/2026-07-02-dead-code-audit.md` added by commit `9cc00803`.

## Scope

Remove the 12 dead row aliases in `packages/db/src/types.ts` called out by the audit.

Before implementation, open `docs/audits/2026-07-02-dead-code-audit.md` on current `origin/main` and copy the exact alias list into your plan. Re-confirm each alias has zero type/value consumers.

## Required Flow

1. `[ -d node_modules ] || pnpm install`.
2. Read AGENTS.md, CLAUDE.md, this handoff, and the coordinated-build skill.
3. Re-confirm the exact alias list against current `origin/main`.
4. Submit a compact plan for coordinator approval before code.
5. Remove only aliases with zero consumers. Preserve generated/live DB table types.
6. Run typecheck and DB/package tests that cover generated type imports; include exact commands and exits in wrap-up.

## Collision Notes

Wave 1 is parallel-safe with #701, #702, #703, and #708. Do not touch `docs/coordination/` from the build branch. Use explicit staging only.
