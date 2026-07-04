# Relay #2 — rfa-721-chat-priority-context-ranking

**Spec:** `docs/superpowers/specs/2026-07-04-chat-priority-context-ranking.md` (tier `sensitive`, verified current)
**Issue:** #721 · **Coordinator label:** `Coordinator` (Codex session `019f2c81-005f-73c3-80bc-fd6d568820f7`)
**Branch/worktree:** `rfa-721-chat-priority-context-ranking` at `~/Jarv1s/.claude/worktrees/rfa-721-chat-priority-context-ranking`

## Status

Research/verification is DONE. **No code written. No plan doc written yet. No coordinator message
sent yet.** `pnpm install` already done — skip it. Tree clean (only untracked
`.claude/context-meter.log`, not ours — leave it).

## Full wiring plan (fully verified this session, not just recalled)

All 7 files were freshly re-read in full this session (not relying on stale memory). The complete
plan — exact code, exact line numbers, exact interfaces to add — is saved in agentmemory:

```
mcp__plugin_agentmemory_agentmemory__memory_smart_search query="#721 chat-priority-context-ranking wiring plan"
```
or recall by id `mem_mr68mk7l_36f6c6bea7e1`, project `jarv1s`. **Read that memory in full before
planning.** It supersedes the earlier `mem_mr68573u_940cff8fad1d` (that one was pre-verification;
this one has confirmed exact code for all 7 touch points: chat `priority-consumer.ts`
`readPriorityModel`, new `ChatPriorityModelAdapter` file, `chat-session-manager.ts` `engineText()`
wiring incl. exact insertion point + the file's silent-catch-no-logger convention, `runtime.ts`
`CreateChatSessionRuntimeDeps`, `routes.ts` `ChatRoutesDependencies`, `module-registry/src/index.ts`
chat registration block, and `settings-ui/priority/index.tsx` muted-source copy).

## Next steps (in order) — resume `coordinated-build` step 1

1. Run `herdr pane list`, confirm **exactly one** pane holds label `Coordinator`. If 0 or >1, halt
   and wait — do not guess.
2. Invoke `superpowers:writing-plans` → write
   `docs/superpowers/plans/2026-07-04-chat-priority-context-ranking.md` (TDD tasks covering the 7
   items in the memory above — new tests go in `tests/unit/` top-level, NOT colocated with package
   src, e.g. append to existing `tests/unit/chat-priority-consumer.test.ts` and
   `tests/unit/priority-settings-ui.test.tsx`, plus a new `tests/unit/chat-session-manager-*.test.ts`
   for the reorder wiring).
3. Message the coordinator: "plan ready for chat-priority-context-ranking: <path>. Approve, or flag
   a fork." **STOP and wait for approval — do not write code first.**
4. After approval: TDD implementation, commit per task (exact files, never `git add -A`), pre-push
   trio before every push, `coordinated-wrap-up` at the end (PR + report only, no merge/board).

## Guardrails (still binding)

No new source reads. No second ranking system. Don't touch `packages/email` or shared Email
behavior without coordinator approval. Don't edit `docs/coordination/`. No repo-wide `pnpm format`.
No `git add -A`/`.`/broad checkout/reset/stash. Rebase after #729 lands (soft overlap expected in
`packages/chat/src/routes.ts`, `packages/briefings/src/compose.ts`,
`packages/briefings/src/signals.ts`) before wrap-up/QA. Keep pg-boss payloads metadata-only,
DataContextDb/VaultContext boundaries, never log/persist source bodies/secrets/connector metadata.
