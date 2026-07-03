# Build Handoff — 702 dead memory methods

**Spec (approved):** GitHub issue #702
**GitHub issue:** #702
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/702-dead-memory-methods` **Branch:** `coord/702-dead-memory-methods` off current green `origin/main`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f25f9-9b63-76f3-9505-a015196d4a41`
**Relay threshold:** ~80-100k tokens or compaction summary.

## Source

Issue #702 from `docs/audits/2026-07-02-dead-code-audit.md` added by commit `9cc00803`.

## Scope

Remove only these confirmed unused memory methods after re-confirming zero callers on current `origin/main`:

- `GraphMemoryRecallService.link` in `packages/memory/src/graph-recall-service.ts`
- `MemoryCandidatesRepository.findBySignature` in `packages/memory/src/candidates-repository.ts`
- `MemoryGraphDashboardRepository.listEntitiesForDashboard` in `packages/memory/src/graph-dashboard-repository.ts`
- `ChatMemorySuppressionsRepository.insertCorrection` in `packages/memory/src/suppressions-repository.ts`
- `ChatMemorySuppressionsRepository.listSuppressions` in `packages/memory/src/suppressions-repository.ts`
- private row mapper(s) that become dead after the suppression methods are removed

## Required Flow

1. `[ -d node_modules ] || pnpm install`.
2. Read AGENTS.md, CLAUDE.md, this handoff, and the coordinated-build skill.
3. Re-confirm zero callers with repo tools and preserve live sibling paths, especially dashboard fact listing.
4. Submit a compact plan for coordinator approval before code.
5. Run focused memory tests plus typecheck; run `pnpm verify:foundation` if package contracts change. Include exact commands and exits in wrap-up.

## Collision Notes

Wave 1 is parallel-safe with #701, #703, #707, and #708. Do not touch `docs/coordination/` from the build branch. Use explicit staging only.
