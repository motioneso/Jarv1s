# Private chat mode without memory writes (#744)

**Status:** Approved (2026-07-07, Ben)
**Date:** 2026-07-05
**Tier:** security-sensitive (privacy/data-retention surface)
**Builds on:** #737 (chat settings split), `packages/chat/src/jobs.ts` (embed-turn / extract-facts
workers), `packages/chat/src/live/persistence.ts` (existing incognito job-skip gate)

## Problem

#737 established that "remember across conversations" is default chat behavior, not a setting, and
split private/incognito chat out as its own spec (#744) because it is a deliberate exception, not a
toggle. Users need a one-off conversation mode that does not get saved to chat history, does not get
distilled into long-term memory, and cannot be resumed later.

This is a scope change from the earlier draft. The partially-built mechanism currently behaves like
"durable transcript, excluded from memory extraction." Ben's product decision is different: private
chat should build toward Claude Desktop's temporary-chat model and equivalent consumer-chat patterns.
A private chat is chosen only when starting a brand-new thread, exists only while that browser tab's
private session is alive, is not listed in history/sidebar surfaces, and is gone forever when the tab
closes or the user starts another chat. Any `chat_threads` row used by the current backend should be
treated as live-session bookkeeping, not a durable history record.

Grounding this spec turned up useful existing machinery, but not the full product behavior:
`app.chat_threads` already has an immutable `incognito` boolean column
(`0058_chat_threads_incognito_immutable.sql`), `POST /api/chat/clear?incognito=true` can already
create an incognito thread, and the persistence layer already skips memory extraction/embed jobs for
that flag. The build should extend that mechanism, not invent a second memory-suppression system.
However, the existing durable `app.chat_messages` write path is no longer acceptable for private
threads.

## What already works today

- **Incognito thread identity already exists.** The existing `chat_threads.incognito` column is
  immutable after creation. A private chat must always start as a new thread with `incognito = true`;
  there is no mid-conversation conversion from an ordinary thread to a private one.
- **The extraction call is skipped, not run-then-discarded.** `DataContextChatPersistence.recordTurn`
  (`packages/chat/src/live/persistence.ts:229`) only enqueues `CHAT_EMBED_TURN_QUEUE` and
  `CHAT_EXTRACT_FACTS_QUEUE` (`packages/chat/src/jobs.ts`) when `!thread.incognito`. For an incognito
  thread, no distillation prompt is built or sent to a model, no `memory_candidates` row is written,
  and no embedding is computed.
- **Passive retrieval / cross-tool reasoning do not see incognito content today.** They read from
  `memory_chunks` and the memory graph (`packages/chat/src/live/passive-retrieval.ts`,
  `packages/chat/src/live/cross-tool-reasoning.ts`), which incognito turns never populate. Acceptance
  should pin this down with tests so future direct read paths do not weaken the guarantee.
- **Usefulness feedback "remember" is gated.** `createChatFeedbackTargetVerifier`
  (`packages/chat/src/feedback-verifier.ts:17`) sets `canRemember = !thread.incognito`, so a user
  cannot promote an incognito-thread message into memory through feedback.
- **Proactive/briefing surfaces that go through `chat.listTodaysTurns` are excluded.** The manifest
  tool (`packages/chat/src/tools.ts:44`) skips incognito threads. No other module should query chat
  internals directly; module isolation requires declared APIs.
- **Multi-turn continuity during an active session does not depend on Postgres chat-message replay.**
  `CliChatEngineImpl.submit()` (`packages/chat/src/live/cli-chat-engine.ts:283-290`) pastes the new
  user text into the already-running CLI/tmux process. The live engine carries the active context; it
  does not read `app.chat_messages` between turns.
- **DB-backed replay is cold-launch-only and default-off.** `ChatSessionManager.launchSession`
  (`packages/chat/src/live/chat-session-manager.ts:295-387`) can call `listPriorTurns`, but that path
  is gated by `JARVIS_CHAT_REPLAY_K`, which defaults to `0`
  (`packages/chat/src/live/persistence.ts:334-339`). `packages/chat/README.md:41-43` also states that
  a cold session should not replay prior chat turns.
- **Refresh already does not restore visible transcript from Postgres automatically.**
  `useChatStream` resets local UI state on remount (`apps/web/src/chat/use-chat-stream.ts:82-110`).
  The server-side live engine survives a refresh because it is keyed per `actorUserId`, not per
  browser connection, and keeps answering. History is fetched only when the user explicitly opens
  History.
- **Only one non-chat export path reads `app.chat_messages` directly.** `packages/settings/src/
data-export.ts:414-429` runs an owner-scoped export query. For private threads, the intended result
  is simply zero message rows.
- **The existing 30-minute idle reaper is a cleanup backstop.** `ChatSessionManager.reapIdle`
  (`packages/chat/src/live/chat-session-manager.ts:790-799`) and runtime configuration
  (`packages/chat/src/live/runtime.ts:56`) already clean stale live engines. This remains operational
  hygiene for crashes, force-quits, killed processes, or missed unload signals. It is not a
  user-facing TTL or retention promise.

## What must change

- **Stop writing private transcript rows.** Today, `ChatRepository.recordCompletedTurn`
  (`packages/chat/src/repository.ts:173`) writes user and assistant messages to `app.chat_messages`
  without an incognito branch. #744 must change that for private threads: no `app.chat_messages` rows
  should be written for incognito turns at all.
- **No durable private thread artifact.** `ChatRepository.listThreads` and client history views must
  omit private threads. If the current backend still needs a `chat_threads` row while the live session
  is active, that row must be cleaned up when the private session ends. There is nothing to resume
  because no durable private chat history exists.
- **No frontend entry point exists.** `apps/web/src/chat/chat-drawer.tsx` has no private-chat action,
  even though the API client already exposes `clearChat({ incognito: true })`
  (`apps/web/src/api/client.ts:655`).
- **No active-session private marking exists.** `serializeThread` (`packages/chat/src/routes.ts:785`)
  does not expose `incognito`, and the web client has no banner/strip/copy that tells the user the
  current tab is in private mode.
- **No kill-on-tab-close signal exists.** `engine.kill()` currently fires from explicit `/clear`
  (`chat-session-manager.ts:698-706`), `resumeThread` (`714-736`), `switchProvider` (`743-751`), and
  the idle reaper. There is no `beforeunload`, `navigator.sendBeacon`, heartbeat-disconnect, or
  equivalent private-tab-close path in `apps/web/src` today.
- **On-disk CLI transcripts outlive the session.** The live engine's underlying CLI writes the full
  conversation as JSONL under the CLI home directory — `transcriptGlobDir`
  (`packages/ai/src/adapters/tmux-bridge.ts:93-115`) maps anthropic to
  `<homeBase>/.claude/projects/<encoded-neutral-dir>/`, openai-compatible to
  `<homeBase>/.codex/sessions/<Y>/<M>/<D>/`, and google to `<homeBase>/.gemini/tmp/.../chats/`.
  `engine.kill()` removes only the per-session neutral dir
  (`cli-chat-engine.ts`, `removeNeutralDirQuietly`) — persona/MCP config plus the codex-exec
  transcript that happens to live inside it. The interactive-CLI transcript files are never deleted,
  so without new work a plaintext copy of every private turn persists on the server filesystem after
  the session "ends". #744 must delete the private session's transcript artifacts on every end path
  (graceful close, new chat, reaper fallback), scoped to that session's own files — the codex
  sessions dir is shared per-day, so remove the session's file(s), not the directory.
- **Bookkeeping row must not carry user-derived content.** `recordTurn` auto-titles the thread from
  the first user turn (`deriveChatTitle`, `packages/chat/src/live/persistence.ts`) and, when replay
  is enabled, writes a rolling `conversation_summary` of turn content. Once private turns stop
  producing `chat_messages` rows both paths should no-op, but the invariant must be pinned
  explicitly: an incognito `chat_threads` row never contains an auto-derived title or a
  `conversation_summary`.

## Scope

1. **Start private chat only as a new chat.** Add a clear product entry point that creates a brand-new
   incognito thread. Do not add any conversion path for an existing ordinary thread.
2. **Make private chat ephemeral.** Private turns must skip both memory extraction/embed jobs and
   `app.chat_messages` writes. Private thread metadata may exist only as live-session bookkeeping and
   must not remain as a durable history/resume artifact after the private session ends. Private
   threads must not be listed in thread/history sidebars, exported as chat transcript rows, or resumed
   later. The bookkeeping row itself must never contain user-derived content: no auto-derived title
   (`deriveChatTitle`) and no `conversation_summary` for incognito threads.
3. **Keep the active tab alive until the user ends it.** Navigating within the app must not kill the
   private session. If the user returns to the same open tab, the chat is still there. Closing the tab
   or starting a new chat permanently ends it. **Session identity (decided 2026-07-05):** live chat
   sessions are keyed per user and the SSE layer fans out to multiple tabs
   (`ChatSessionManager.subscribe`), so "tab open" is tracked as an SSE-subscriber refcount — the
   private session lives while at least one subscriber is attached and ends when the last subscriber
   detaches, after a short grace window so a reload does not end the session. A
   `beforeunload`/`navigator.sendBeacon` kill request remains a best-effort accelerator only.
   Kill-on-any-close is the approved fallback if the refcount proves unworkable during build (its UI
   copy must then state that closing any tab ends the private chat). Because no `app.chat_messages` rows exist, the visible
   transcript can never be refetched from the server; the client must keep the private transcript's
   UI state alive across in-app navigation (today `useChatStream` state is component-local and resets
   on remount).
4. **Kill the underlying engine when the private session ends.** Add in-scope work for a tab-close
   signal — a `beforeunload` handler using `navigator.sendBeacon` or equivalent, hitting a new
   server route that kills the private live engine — as a best-effort accelerator for the
   subscriber-refcount lifetime in item 3. Keep the existing 30-minute idle reaper only as a
   fallback when graceful cleanup fails. **Reaper interaction (decided 2026-07-05):** an attached
   SSE subscriber counts as activity, so an open tab is never reaped — the reaper collects only
   private sessions with zero attached subscribers. For residual cases where the engine dies anyway
   (server restart, crash), the client must detect the dead engine and show a "private chat ended"
   state instead of silently continuing in a fresh, context-free engine. The design must not turn
   ordinary in-app navigation into cleanup; the grace window in item 3 covers reload.
   Whatever ends the session — graceful close, new chat, or the reaper — must clean up all three
   artifacts: the live engine, the incognito bookkeeping `chat_threads` row, and the on-disk CLI
   transcript files (item 7). Today the reaper only kills the engine; assigning it the other two for
   incognito sessions is in scope, otherwise the "no durable record" criterion is unmeetable on the
   crash/ungraceful path.
5. **Assert the memory boundary with tests.** Prove private turns enqueue no memory jobs, create no
   `memory_candidates`/`memory_chunks`, and do not promote graph facts/entities.
6. **Preserve module-owned action audit trails.** Private chat suppresses chat's own persistence and
   memory pipeline only. If the user approves or triggers a real action in email/calendar/tasks/etc.,
   that owning module keeps its normal action record.
7. **Purge on-disk CLI transcript artifacts.** The provider CLI writes the full conversation as
   JSONL under `transcriptGlobDir` (`packages/ai/src/adapters/tmux-bridge.ts`); `engine.kill()` does
   not remove it. Every private-session end path (tab close, new chat, idle reaper) must also delete
   the private session's transcript file(s). Deletion must be scoped to the session's own files —
   e.g. the codex per-day sessions directory is shared across sessions.

## Non-goals / Guardrails

- **Do not build private mode as a toggle on an existing thread.** Private mode is chosen at new-chat
  creation, full stop.
- **Do not build durable-but-marked private history.** That was the previous draft's likely path and
  is now explicitly rejected. "Private" means no durable chat transcript and no resume affordance.
- **Do not add an independent TTL/idle-expiry product.** The lifetime is tab-open until close or new
  chat. The idle reaper remains an operational cleanup fallback, not a user-facing retention window.
- **Do not build general chat deletion/retention.** Private-chat cleanup should be scoped to private
  live sessions and private chat persistence avoidance, not a delete-any-thread feature.
- **Do not build a second memory-suppression mechanism.** Keep the existing skip-the-call path in
  `persistence.ts`; do not write memory rows and delete them afterward.
- **Do not conflate per-thread incognito with global `chat_user_memory_settings`
  (`recallEnabled`/`factsEnabled`).** They answer different questions and must remain independently
  controllable.
- **Do not clear or suppress module-owned audit trails.** Action approvals, tool execution records,
  and external side effects belong to the module that performed the action, not to chat history.
- **Secrets never escape.** Nothing in private mode may loosen existing secret filters or
  metadata-only job-payload rules.

## Lifecycle

- User chooses "start private chat" from the new-chat entry point.
- Server creates a brand-new live private thread with `incognito = true`; any durable row used to
  support that live session is bookkeeping only.
- Active turns run through the live CLI/tmux engine, preserving conversational continuity in memory
  while the tab remains open.
- Completed private turns do not write `app.chat_messages` rows and do not enqueue embed/extract jobs.
- The private session stays alive across in-app navigation as long as the tab remains open and the
  live engine remains alive.
- The private session is omitted from history/sidebar lists and has no resume affordance.
- The private session ends when its last attached SSE subscriber detaches and a short grace window
  elapses (a reload re-attaches within the grace window and survives); closing a tab also sends a
  best-effort `sendBeacon` kill request as an accelerator.
- Starting any new chat also ends the current private session.
- Ending the private session cleans up private thread bookkeeping rows and the session's on-disk CLI
  transcript files as well as the live engine.
- If the browser or process dies without a graceful close signal, the existing idle reaper eventually
  kills the stale live engine as infrastructure cleanup; for incognito sessions the reaper also
  deletes the bookkeeping row and transcript files, so the ungraceful path still converges to zero
  durable artifacts. An attached SSE subscriber counts as activity, so the reaper never collects a
  private session with an open tab.
- If the engine is gone while a tab still shows the conversation (server restart, crash), the client
  shows a "private chat ended" state rather than silently continuing in a fresh engine.

## Open questions

Session lifetime identity and reaper interaction were decided by Ben on 2026-07-05 and are recorded
in Scope items 3–4. Remaining open items are UI-design details only:

- **Exact entry-point affordance and copy.** The decision is "start private chat as a new chat," but
  the specific UI shape can still be chosen during design: a separate action next to New Chat, a menu
  item under New Chat, or equivalent.
- **Exact active-session visual treatment.** The active private tab needs clear marking, but final
  banner/strip/copy treatment can be decided in UI design. It must not imply that approved external
  actions leave no records.

## Acceptance criteria

- A user can start a private chat only as a brand-new chat. There is no affordance or route behavior
  that converts an existing ordinary thread into private mode.
- The active private session is clearly marked for as long as it is open.
- Private threads use the existing immutable `chat_threads.incognito = true` mechanism.
- Completed private turns do not enqueue `CHAT_EMBED_TURN_QUEUE` or `CHAT_EXTRACT_FACTS_QUEUE`;
  add/keep a regression test asserting `sendJob` is not called for `thread.incognito === true` in
  `DataContextChatPersistence.recordTurn`.
- Completed private turns write zero `app.chat_messages` rows.
- Completed private turns produce zero rows in `memory_chunks`, zero rows in `memory_candidates`, and
  no promoted entity/fact in the memory graph.
- Private threads never appear in thread/history/sidebar lists and cannot be resumed.
- Ending a private session leaves no durable private `chat_threads` history/resume record behind —
  including on the ungraceful path, where the idle reaper deletes the orphaned incognito
  bookkeeping row.
- An incognito `chat_threads` bookkeeping row never contains user-derived content: no auto-derived
  title and no `conversation_summary`.
- Ending a private session — on any path: graceful tab close, starting a new chat, or the
  idle-reaper fallback — deletes the session's on-disk CLI transcript files (`transcriptGlobDir`
  artifacts); no private turn text remains on the server filesystem afterward.
- The visible private transcript survives in-app navigation within the same tab; the client keeps
  the transcript state because it is not refetchable by design.
- Private chat transcript rows are absent from owner data export output because no private
  `app.chat_messages` rows exist.
- The private session ends when its last attached SSE subscriber detaches and the grace window
  elapses: closing the only open tab ends the session; a reload within the grace window does not
  end it; with two tabs attached, closing one does not end it.
- Closing a private-chat tab sends a best-effort kill signal (`sendBeacon`) as an accelerator for
  the subscriber-refcount lifetime.
- The idle reaper never reaps a private session with an attached SSE subscriber; it collects only
  zero-subscriber private sessions.
- If the private engine is gone while the tab still shows the conversation (server restart, crash),
  the client shows a "private chat ended" state instead of silently continuing in a fresh engine.
- Starting a new chat kills the previous private live engine.
- In-app navigation does not kill the private session while the same tab stays open.
- The existing 30-minute idle reaper remains as fallback cleanup for missed tab-close signals, but no
  TTL/idle-expiry product copy or setting is introduced.
- Usefulness feedback cannot "remember" a message from a private thread.
- `chat.listTodaysTurns` and surfaces built on it continue to exclude private threads.
- Approved module actions taken from private chat keep their owning module's normal audit/action
  records.
- No private full-turn text appears in job payloads, structured logs, or diagnostics.
