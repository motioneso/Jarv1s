# Build Handoff — 664-chat-message-location

**Spec / source (approved bugfix):** GitHub issue #664, "User message location when chatting with Jarvis"
**GitHub issue:** #664
**Risk tier:** `routine` unless premise verification proves the fix must touch chat turn lifecycle, API contracts, auth, RLS, or persisted data semantics.
**Worktree:** `~/Jarv1s/.claude/worktrees/664-chat-message-location`
**Branch:** `coord/664-chat-message-location` off `origin/main` at `c2aebbc8`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2305-7128-7723-9d5f-f1a8b7b11e65`
**Relay threshold:** countable events — ~80-100k tokens OR a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read this handoff and issue #664 in full.
3. Invoke `coordinated-build`.
4. Before planning, reproduce or verify the current code path for the reported UI behavior:
   user messages appear pinned/tagged at the top of the chat window until an assistant response
   arrives, making the sent message look missing when the user is scrolled further down.
5. Submit a compact plan to the coordinator for approval before writing implementation code.

## Scope

- Fix the smallest shared UI/root-cause path that controls user-message placement while a response
  is pending.
- Preserve existing chat transport, turn lifecycle, persistence, and assistant streaming semantics.
- Add the smallest runnable check that fails if pending user messages render in the wrong location.

## Discovery Pointers

- Code graph points at `apps/web/src/chat/markdown-message.tsx` for message rendering and
  `packages/chat/src/routes.ts` / `packages/chat/src/repository.ts` for server serialization.
- Use code graph first for definitions/callers, then fall back to `rg` for string literals/CSS.

## Compact

- Work only in this worktree/branch.
- Commit green per task; stage only files you changed.
- Do not touch `docs/coordination/`, project board, milestones, or merge state.
- Required local checks for wrap-up: relevant focused test(s), `pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`; run broader checks only if your touched surface warrants it.
- Escalate to `Coordinator` for plan approval, blockers, design forks, or done.

## Collision Notes

- #663, #643, #579 are queued after this lane. No live build writer currently owns chat UI files.
- If this turns into chat lifecycle/API work instead of pure UI placement, stop and escalate with
  the touched files and proposed tier change.
