# Relay #3 — rfa-721-chat-priority-context-ranking

**Spec:** `docs/superpowers/specs/2026-07-04-chat-priority-context-ranking.md` (tier `sensitive`)
**Issue:** #721 · **Coordinator label:** `Coordinator` (Codex session `019f2c81-005f-73c3-80bc-fd6d568820f7`)
**Branch/worktree:** `rfa-721-chat-priority-context-ranking` at `~/Jarv1s/.claude/worktrees/rfa-721-chat-priority-context-ranking`

## Status

**Plan is WRITTEN, self-reviewed, and committed:**
`docs/superpowers/plans/2026-07-04-chat-priority-context-ranking.md` — 6 TDD tasks with complete
code, exact paths, run commands, and per-task commit steps. Self-review done (spec coverage
mapped in the plan's exit-criteria table; harnesses verified against
`tests/unit/chat-session-manager-provenance.test.ts`, `tests/unit/chat-priority-consumer.test.ts`,
`tests/unit/priority-settings-ui.test.tsx`).

**No code written. Coordinator has NOT yet been sent the plan-ready message — that is your first
action.** `pnpm install` already done — skip it (`[ -d node_modules ] || pnpm install`). Tree
should be clean after the relay commit (untracked `.claude/context-meter.log` is not ours — leave it).

## Next steps (in order) — resume `coordinated-build` step 1 (approval gate)

1. `herdr pane list` — confirm **exactly one** pane holds label `Coordinator`. If 0 or >1, halt.
2. Message it via `herdr-pane-message`: "plan ready for chat-priority-context-ranking:
   docs/superpowers/plans/2026-07-04-chat-priority-context-ranking.md. Approve, or flag a fork."
   **STOP and wait for approval — do not write code first.**
3. After approval: implement task-by-task with `superpowers:test-driven-development`. The plan is
   fully self-contained (read it, not old agentmemory saves — the earlier memories are superseded
   and agentmemory search is unreliable anyway). Execution skills (`executing-plans`,
   `subagent-driven-development`) are disabled in this repo — drive tasks yourself. Commit per
   task with exact file staging (never `git add -A`).
4. Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck` +
   `git fetch origin main && git rebase origin/main`. **Rebase again after PR #729 lands** (soft
   overlap expected in `packages/chat/src/routes.ts`) before wrap-up/QA.
5. Finish with `coordinated-wrap-up` (push, PR against main referencing issue #721, report to
   coordinator). No merge/board/issue-close — coordinator owns those.
6. Self-monitor context: relay at ~80–100k tokens or immediately on seeing a compaction summary.

## In-flight notes for the builder

- Plan Task 4 test 3 asserts `result.reply` from `manager.submitTurn(...)` — verify the actual
  return shape during the red phase and adjust the assertion if needed (the provenance test never
  reads the return value). Everything else in the plan was verified against the branch.
- `chat-session-manager.ts` has NO logger — the plan's silent try/catch around the priority
  reorder is deliberate (matches file convention; deviation from briefings' logged event).
- `PreferencesRepository` at the composition root comes from `@jarv1s/structured-state`
  (module-registry line ~47 import) — NOT `@jarv1s/priority`'s `PriorityPreferencesRepository`
  (that one is the pure normalizer used inside `readPriorityModel`).

## Guardrails (still binding — same as relay-2)

No new source reads. No second ranking system. Don't touch `packages/email` or shared Email
behavior without coordinator approval. Don't edit `docs/coordination/`. No repo-wide `pnpm format`.
No `git add -A`/`.`/broad checkout/reset/stash. Keep pg-boss payloads metadata-only,
DataContextDb/VaultContext boundaries, never log/persist source bodies/secrets/connector metadata.
