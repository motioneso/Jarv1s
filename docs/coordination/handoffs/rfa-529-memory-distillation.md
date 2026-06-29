# Build Handoff — rfa-529-memory-distillation

**Spec (approved):** docs/superpowers/specs/2026-06-27-memory-distillation-pipeline.md
**GitHub issue:** #529
**Risk tier:** `security`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-529-memory-distillation
**Branch:** `rfa-529-memory-distillation`, stacked on `origin/rfa-528-memory-graph-substrate`
at PR #545 head `519ad54`
**Build skill path:** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f0790-01da-70a2-a013-554a014c24b6`
**Relay threshold:** at ~80-100k tokens or any compaction summary, relay immediately.

## Start

1. Resolve the `coordinated-build` skill. If it is unavailable by name, read and follow the build
   skill path above directly.
2. Run `[ -d node_modules ] || pnpm install`.
3. Read the spec in full.
4. Verify the spec premises against this branch before planning. This branch intentionally includes
   #528's memory graph substrate because #529 depends on it.
5. Write a plan, send it to `Coordinator` for approval, then stop until approved.
6. After approval, build with TDD, commit green per task, and use `coordinated-wrap-up`.

## Non-Negotiables

- Do not merge, edit project boards, or touch milestones.
- Do not touch `docs/coordination/` except this handoff file.
- Stage explicit paths only; no `git add -A`.
- Use lane DB `jarvis_build_rfa_529_memory_distillation` for full gates.
- PR base should be `rfa-528-memory-graph-substrate` while #528 is unmerged. The coordinator will
  retarget/rebase after #528 lands.
- Keep queue name `chat.extract-facts`; product/docs/code comments should speak in terms of memory
  distillation, not a new queue name.
- Incognito turns create no episode and enqueue no distillation job.
- Job payloads stay metadata-only. No prompts, excerpts, private content, or secrets in pg-boss
  payloads.
- Candidate consolidation and graph promotion must write through #528 public memory repositories or
  services, not raw graph-table SQL. Direct SQL is allowed only for the new candidate store.
- Pending candidates do not participate in normal recall or active memory until a later review flow.
- V1 meaningfulness gating is deterministic only. Do not add a model-based classifier in this lane.
- Candidate signatures are owner-scoped suppression keys across all statuses; preserve that
  invariant on insert/update paths.
- Honor CLAUDE.md hard invariants: DataContextDb only, private by default, no secrets/private data
  in prompts/logs/job payloads/exports, module isolation, provider-agnostic AI.

## Collision Notes

- #528 / PR #545 owns graph substrate schema, repositories, recall service, export/delete hooks,
  assistant tools, and migration `0118`; treat those as dependency surfaces, not refactor targets.
- If this lane needs the candidate-store migration the assigned slot is
  `packages/memory/sql/0119_memory_candidates.sql`. Do not renumber or edit `0118`.
- #530 is concurrently stacked on the same #528 head and touches chat memory recall. Avoid drifting
  shared chat seams beyond what #529 needs for episode capture and distillation trigger wiring.
- #532, #533, #535, #537, and #538 will later touch the same memory graph surfaces. Keep this lane
  focused on episode capture, meaningfulness gate, candidate extraction/consolidation/promotion,
  and worker wiring.
- #537 owns commitment actioning. Distillation may detect commitments, but it must leave them
  pending rather than creating tasks/reminders/jobs here.

## Verification Expectations

- Unit tests for `shouldDistillTurn`, candidate parsing, signature normalization, and promotion
  threshold decisions.
- Repository/integration coverage for owner-scoped candidate uniqueness, suppression persistence,
  episode capture, and no-op behavior on incognito turns.
- Worker/integration coverage proving extraction failure never blocks chat completion and graph
  promotion respects owner scoping and pending-vs-promoted rules.
- Local gate before wrap-up: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
  targeted chat/memory tests, and the lane DB full gate if feasible.
