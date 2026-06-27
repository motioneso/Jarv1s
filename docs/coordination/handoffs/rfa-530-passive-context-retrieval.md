# Build Handoff — rfa-530-passive-context-retrieval

**Spec (approved):** docs/superpowers/specs/2026-06-27-passive-context-retrieval.md
**GitHub issue:** #530
**Risk tier:** `sensitive`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-530-passive-context-retrieval
**Branch:** `rfa-530-passive-context-retrieval`, stacked on `origin/rfa-528-memory-graph-substrate`
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
   #528's memory graph substrate because #530 depends on it.
5. Write a plan, send it to `Coordinator` for approval, then stop until approved.
6. After approval, build with TDD, commit green per task, and use `coordinated-wrap-up`.

## Non-Negotiables

- Do not merge, edit project boards, or touch milestones.
- Do not touch `docs/coordination/` except this handoff file.
- Stage explicit paths only; no `git add -A`.
- Use lane DB `jarvis_build_rfa_530_passive_context` for full gates.
- PR base should be `rfa-528-memory-graph-substrate` while #528 is unmerged. The coordinator will
  retarget/rebase after #528 lands.
- This is a stacked dependency: do not duplicate or rewrite #528 memory graph substrate work. Use
  #528's public memory graph APIs and preserve its security/RLS behavior.
- No direct cross-module table queries. Chat may depend on memory package public APIs, not memory
  internals or raw graph tables.
- Retrieved context must be delimiter-neutralized, hidden from persisted chat transcript, and framed
  as context rather than instructions.
- Retrieval failures and timeouts must fail open to the normal user turn with metadata-only logs.
- Honor CLAUDE.md hard invariants: DataContextDb only, private by default, no secrets/private data
  in prompts/logs/job payloads/exports, module isolation, provider-agnostic AI.

## Collision Notes

- #528 / PR #545 owns graph schema, routes, graph recall service, assistant tools, export/delete
  hooks, and migration `0118`; treat those as dependency surfaces, not code to refactor.
- #529, #532, #533, #535, #537, and #538 will also touch memory graph surfaces later. Keep #530
  focused on chat passive retrieval and avoid schema changes.
- #525 will later own cross-tool reasoning. Do not add notes/email/calendar/tasks retrieval here.
- #526 is concurrently reworking priority/settings surfaces; avoid unrelated settings/UI changes.

## Verification Expectations

- Focused tests for the pure retrieval planner trigger/skip cases.
- Chat tests proving retrieved context injection, non-persistence of hidden context, timeout/failure
  fail-open behavior, and settings gating.
- Integration coverage proving user A cannot retrieve user B's memory.
- Local gate before wrap-up: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`,
  `pnpm test:chat`, `pnpm test:memory`, and the lane DB full gate if feasible.
