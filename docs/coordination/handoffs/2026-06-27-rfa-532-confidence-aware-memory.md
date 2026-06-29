# Build Handoff - RFA #532 Confidence-Aware Memory

**Spec (approved):** docs/superpowers/specs/2026-06-27-confidence-aware-memory-records.md
**GitHub issue:** #532
**Risk tier:** `security`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-532-confidence-aware-memory
**Branch:** rfa-532-confidence-aware-memory off origin/main@4e9f128
**Build skill path:** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f0ae5-0afd-7092-911e-6c2e987df7f2`
**Relay threshold:** countable events - ~80-100k tokens OR a compaction summary in your own context.

## Start

1. Resolve `coordinated-build`; if unavailable, read the build skill path above in full.
2. Run `[ -d node_modules ] || pnpm install`.
3. Read the spec in full.
4. Verify the spec against this branch before planning.
5. Write the plan, then escalate to `Coordinator` for approval before coding.

## Compact

- CI gate: local `pnpm format:check && pnpm lint && pnpm typecheck`, focused vitest files, then PR CI.
- Work only in this worktree/branch. Stage explicit paths only. No `git add -A` / `git add .`.
- Never touch docs/coordination, project board, milestones, or merges.
- Honor CLAUDE.md hard invariants: owner-only/RLS, DataContextDb only, no secrets in payloads/logs/prompts/exports.
- Caveman mode for coordinator status/escalations.

## Collision Notes

- Assigned migration slot: `0121_confidence_aware_memory_records.sql`.
- This lands after #527's assigned `0120` slot. Do not renumber unless the coordinator tells you.
- Reuse #528/#529 memory graph repositories/contracts. Do not create a second memory store,
  second recall engine, or dashboard.
- Pending #529 candidates must remain out of normal recall. Confidence metadata must not lower
  auto-promotion thresholds.
- #525 is held while this lane plans/builds because both touch chat hidden-context/runTurn behavior.
- Export/delete/RLS coverage and inactive/stale/superseded recall gates are part of the security bar.
