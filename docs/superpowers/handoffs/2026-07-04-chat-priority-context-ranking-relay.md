# Relay — rfa-721-chat-priority-context-ranking

**Spec:** `docs/superpowers/specs/2026-07-04-chat-priority-context-ranking.md`
**Handoff:** `docs/coordination/handoffs/2026-07-04-rfa-fleet/rfa-721-chat-priority-context-ranking.md`
**Issue:** #721 · **Coordinator label:** `Coordinator` (Codex session `019f2c81-005f-73c3-80bc-fd6d568820f7`)
**Branch/worktree:** `rfa-721-chat-priority-context-ranking` at
`~/Jarv1s/.claude/worktrees/rfa-721-chat-priority-context-ranking`

## Status

Relaying at the research→plan boundary, before writing the plan doc or messaging the coordinator.
**No code written. No plan doc written yet. No coordinator message sent yet.** `pnpm install` done.
Tree is clean (only an untracked `.claude/context-meter.log`, not ours).

Spec verified current against this branch — no drift, no re-scope needed.

## Full wiring plan

The complete researched plan (exact files/lines/patterns to mirror) is saved in agentmemory:

```
mcp__plugin_agentmemory_agentmemory__memory_smart_search query="#721 chat-priority-context-ranking wiring plan"
```
or recall by id `mem_mr68573u_940cff8fad1d`, project `jarv1s`. **Read that memory in full before
planning** — it covers all 6 concrete changes (chat priority-model port/adapter, wiring
`rankChatContext` into `ChatSessionManager.engineText()`, threading `priorityPreferences` through
runtime.ts/routes.ts/module-registry, and the settings-ui muted-source "explain" treatment for
memory/wellness) plus which files/line ranges to mirror (briefings' `compose.ts` `orderByPriority`,
`priority-consumer.ts` `readPriorityModel`, chat's `passive-retrieval.ts` DI pattern).

## Next steps (in order)

1. Run `herdr pane list`, confirm **exactly one** pane holds label `Coordinator`. If 0 or >1, halt
   and wait — do not guess.
2. Invoke `superpowers:writing-plans` → write
   `docs/superpowers/plans/2026-07-04-chat-priority-context-ranking.md` (TDD tasks covering the 6
   items in the memory above, plus focused tests: chat cross-tool ordering changes with priority
   model, muted-source suppression for notes/tasks/calendar/email, settings-ui copy for
   memory/wellness).
3. Message the coordinator: "plan ready for chat-priority-context-ranking: <path>. Approve, or flag
   a fork." **STOP and wait for approval — do not write code first.**
4. After approval: TDD implementation, commit per task (exact files, never `git add -A`), pre-push
   trio before every push, `coordinated-wrap-up` at the end (PR + report only, no merge/board).

## Guardrails (from handoff, still binding)

No new source reads. No second ranking system. Don't touch `packages/email` or shared Email
behavior without coordinator approval. Don't edit `docs/coordination/`. No repo-wide `pnpm format`.
No `git add -A`/`.`/broad checkout/reset/stash. Rebase after #729 lands (soft overlap expected in
`packages/chat/src/routes.ts`, `packages/briefings/src/compose.ts`,
`packages/briefings/src/signals.ts`) before wrap-up/QA. Keep pg-boss payloads metadata-only,
DataContextDb/VaultContext boundaries, never log/persist source bodies/secrets/connector metadata.
