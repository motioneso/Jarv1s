# Retire the Legacy (Worker-Backed) Chat Model — Design Spec

**Date:** 2026-06-08
**Status:** Approved (scope confirmed by owner)
**Related:** `docs/superpowers/specs/2026-06-08-jarvis-chat-design.md` (the live drawer redesign),
ADR `docs/architecture/decisions/0003-interactive-chat-is-cli-transport.md`, PR #21 (live runtime),
branch `fix/jarvis-chat-clear-transcript-rotation` (the `/clear` fix this builds on).

---

## 1. Summary

Jarv1s shipped two chat implementations side by side:

- **Live drawer** (PR #21): browser → API → persistent per-user `claude` CLI in tmux, SSE-streamed,
  in-process, born-complete turns. Routes `/api/chat/turn|clear|switch|stream`, engine
  `live/cli-chat-engine.ts`.
- **Legacy worker model** (M-A3): a thread/message REST CRUD page → pg-boss worker job → one-shot
  `ChatProviderAdapter` (`TmuxBridgeAdapter` for CLI, `HttpApiAdapter` for API key).

The legacy model is superseded and will not ship. This spec removes it and makes the live chat a
**global, per-user, persistent slide-out drawer** mounted in the app shell (the harness): toggled from
the **Chat** nav item and available from every page, persisting across navigation — not a routed
thread-management page. Nothing currently depends on the legacy model (early days; confirmed by owner).

## 2. Goals / Non-goals

**Goals**

- The live chat is a **global slide-out drawer** mounted at the app-shell level, toggled from the
  **Chat** nav item, that persists across page navigation (per-user, follows the user everywhere).
  The `/chat` route and its page are removed.
- Delete the legacy chat UI, worker job, legacy REST routes, and the now-dead `TmuxBridgeAdapter`.
- Leave the codebase green (`pnpm verify:foundation`) with no orphaned dead code **except** the one
  deliberately-retained substrate below.

**Non-goals**

- The fully-docked, always-visible chat panel (the long-run direction — see §6). This spec delivers
  the global _toggleable_ drawer; an always-on docked layout is follow-up.
- Building API-key chat _into the drawer_ (future work — see §4).
- Dropping the `chat_threads` / `chat_messages` tables or their migrations (the live runtime uses
  both; RLS classification unchanged).
- Touching Phase 2 (MCP tools) or Phase 3 (recall).

## 3. Hard-invariant compliance

- **Spec before build** — this document.
- **Module isolation** — changes stay within `@jarv1s/chat`, `@jarv1s/ai`, `@jarv1s/shared`, and
  `apps/web` / `apps/worker`. No module reaches into another's internals or tables.
- **DataContextDb / RLS** — removal only deletes code paths; the live runtime keeps running every
  query through `DataContextRunner`. No RLS, AccessContext, or migration changes.
- **Never edit applied migrations** — the chat worker grants (0036/0037) stay as-is. Dropping the
  pg-boss chat queue is optional cleanup, not a migration edit.

## 4. Key decision — keep `HttpApiAdapter` as staged substrate

The API-key path's provider HTTP integration (`packages/ai/src/adapters/http-api.ts` +
`transcript-reader.ts` + the `ChatProviderAdapter` / `ChatActivityEvent` / `ChatTurn` types in
`chat-adapter.ts`) is the substrate for a **planned** near-term feature: wiring API-key providers into
the drawer. The shapes differ — the legacy seam is one-shot `generateChat(input) → { text }`, the
drawer seam is streaming `CliChatEngine` (`launch`/`submit`/`readNew`/`kill`) — so it is **not**
drop-in; the tie-in will adapt the HTTP logic to the engine seam. We therefore **retain**
`HttpApiAdapter` + `transcript-reader.ts` + the adapter types, even though they become temporarily
unreferenced after Phase B. They remain exported from `@jarv1s/ai`. A short retention note will be
added so a future reader knows it is intentionally kept, not forgotten dead code.

`TmuxBridgeAdapter` (one-shot CLI) has a direct, superior replacement already shipped
(`live/cli-chat-engine.ts`), so it is **removed**, not retained.

## 5. Inventory — keep vs remove (verified)

### Frontend (`apps/web/src`)

- **Remove:** `chat/chat-page.tsx` entirely (the whole legacy page — `CreateThreadForm`, `ThreadList`,
  `RouteStatus`, `ToolSelector`, `MessageList`, `Composer`), the `/chat` `<Route>` + `ChatPage` import
  in `app.tsx`, and the thread/message client functions (`createChatThread`, `getChatThread`,
  `listChatMessages`, `appendChatUserMessage`) in `api/client.ts` + their query keys.
- **Keep:** `chat/chat-drawer.tsx` (the overlay drawer — now mounted globally), `chat/use-chat-stream.ts`,
  `listChatThreads`, `sendChatTurn`, `clearChat`, `switchChatProvider`, `chatStreamUrl`.
- **Change (global mount):** mount `ChatDrawer` once in the app shell (`shell/app-shell.tsx`), above
  the router outlet, so it persists across navigation. Drawer open/closed state lives in the shell (or
  a small `ChatDrawerContext`). The **Chat** nav item becomes a **toggle button** for the drawer
  instead of a `NavLink` to `/chat`. To keep the conversation "following" the user, the chat stream +
  records (`useChatStream`) are lifted to the shell/context so they persist while the drawer is closed
  and across route changes (today they unmount when the drawer closes — see §6).

### Backend routes (`packages/chat/src/routes.ts`)

- **Remove:** `POST /api/chat/threads` (create), `GET /api/chat/threads/:id`,
  `GET /api/chat/threads/:id/messages`, `POST /api/chat/threads/:id/messages` (enqueue), plus the
  `boss.send` enqueue wiring and `ChatExecutionJobPayload` usage in this file.
- **Keep:** `GET /api/chat/threads` (drawer history) and the entire `registerChatLiveRoutes(...)`
  block + `createChatSessionRuntime`.

### Worker (`packages/chat/src/jobs.ts` + `apps/worker`)

- **Remove:** `jobs.ts` (the chat execution job handler) and its registration/queue wiring in the
  worker. Drop `export * from "./jobs.js"` from `packages/chat/src/index.ts`.

### AI adapters (`packages/ai/src`)

- **Slim (not delete) `adapters/tmux-bridge.ts`:** remove the `TmuxBridgeAdapter` class, `SESSION_PREFIX`, `CLI_FOR`, `buildPromptText`. **Keep** `TmuxIo`, `createRealTmuxIo`, `transcriptGlobDir` — the live persistent-session engine (`live/runtime.ts`) imports all three.
- **Slim `chat-adapter.ts`:** remove `createChatAdapter` factory, `CreateChatAdapterDeps`, `realTmuxIo`, `CLI_PROVIDER_KINDS`. **Keep** `ChatProviderAdapter`, `ChatActivityEvent`, `ChatTurn`, `GenerateChatInput` types and `HttpApiAdapter` re-export (substrate for future API-key-in-drawer).
- **Keep unmodified:** `adapters/http-api.ts`, `adapters/transcript-reader.ts`.

### Repository (`packages/chat/src/repository.ts`)

- **Remove (legacy-only):** `createThread`, `appendUserMessage`, `updateMessageStatus`,
  `appendActivity`, `updateMessageComplete`, `ChatExecutionJobPayload` / the enqueue constructor arg.
- **Keep (live runtime):** `getThreadById` (**correction from original spec** — live `recordCompletedTurn` calls it), `listThreads`, `listMessages`, `getCurrentThread`, `openNewThread`, `recordCompletedTurn`, `touchThread`.

### Shared contracts (`packages/shared`)

- **Remove:** `createChatThreadRouteSchema`, `getChatThreadRouteSchema`, `listChatMessagesRouteSchema`,
  `appendChatUserMessageRouteSchema`; remove unused request/response interfaces (`CreateChatThreadResponse`, `GetChatThreadResponse`, `ListChatMessagesResponse`, `AppendChatUserMessageResponse`) and all internal helper schemas they depend on.
- **Keep:** `listChatThreadsRouteSchema`, `listChatThreadsResponseSchema`, `ChatThreadDto`, `ListChatThreadsResponse`, `CreateChatThreadRequest`, `AppendChatUserMessageRequest`, `ChatMessageDto`, `ChatMessageStatus`, `ChatSelectedToolMetadataDto`, and all types still referenced by `tests/e2e/mock-chat-api.ts`.

### Tests

- **Delete:** `tests/integration/chat.test.ts` (legacy worker/CRUD), `tests/unit/ai-chat-adapter-factory.test.ts` (factory removed).
- **Slim:** remove stale `updateMessageComplete` cases from `tests/integration/chat-live.test.ts`; remove `TmuxBridgeAdapter` describe block from `tests/unit/ai-tmux-bridge.test.ts` (**keep** `parseTranscript` and `transcriptGlobDir` coverage — file is slimmed, not deleted); fix `ai-tools.test.ts` queue-name assertion to drop `chat-execution`.
- **Keep:** `chat-live.test.ts` (live repository coverage), `ai-tmux-bridge.test.ts` (transcript reader + glob dir), `http-api` adapter tests.

### Database

- **Keep:** `chat_threads`, `chat_messages`, all chat migrations (used by the live runtime). No
  schema change.

## 6. Frontend design — global persistent chat drawer

The chat **stays a slide-out drawer** (`aside.chat-drawer`), but **non-modal** — the full-screen scrim
is removed so the rest of the app (including the nav) stays interactive while chat is open. What
changes is _where it lives_ and _how long it lives_: today it's mounted by the legacy page, modal, and
only exists while that route is open; it must become a **global, per-user, non-modal surface in the
harness** that follows the user everywhere. (A modal scrim would block navigation and defeat
"follows-you"; closing is via the X button or the nav toggle.)

- **Mount once, globally.** Render `ChatDrawer` in `app-shell.tsx`, above the `<Routes>` outlet, so it
  is present on every page and is not torn down by navigation. Open/closed state lives in the shell
  (or a tiny `ChatDrawerContext`).
- **Toggle from the nav.** The **Chat** nav item toggles the drawer (open ⇄ closed) instead of routing
  to `/chat`. (A global keyboard shortcut can come later.)
- **Persist the conversation across navigation.** Lift `useChatStream` (the SSE connection + the
  `records` it accumulates) above the open/closed boundary — into the shell or a context provider —
  so the live transcript keeps streaming and stays intact while the drawer is closed and as the user
  moves between pages. (Today `ChatDrawer` returns `null` when closed, which unmounts the stream and
  drops the in-memory transcript; that must change for a "follows-you" chat.) Server-side conversation
  state already persists regardless; this is about the client surface not resetting.
- **Per-user.** The SSE stream is already actor-scoped server-side; nothing global leaks across users.
- **Mental model:** a support-chat-style toggle widget — floating, always one click away, following the
  user — not a destination page.
- **Reload behaviour (decided): in-session only.** Across navigation the transcript persists (the
  stream stays mounted); on a full page reload it resets to empty (matching today's "no replay on
  reload"). Persisting across reload is deliberately deferred and is **purely additive** later — a
  mount-time fetch of the current conversation's `chat_messages` (via `getCurrentThread` +
  `listMessages`, already present server-side) to seed the records, plus one localStorage boolean for
  open/closed state. It needs no rework of the global-drawer or lifted-stream design, so pulling it
  forward now buys nothing.
- **Long-run (non-goal here):** evolve from a toggleable overlay into an always-present _docked_ panel
  (a true persistent window beside page content). This spec delivers the global toggleable drawer; the
  docked layout + visual redesign are follow-up, since the owner noted the chat display will keep
  evolving.

## 7. Phasing

- **Phase A — Frontend (own PR):** mount `ChatDrawer` globally in `app-shell.tsx`, lift drawer
  open-state + `useChatStream` to the shell/context, make the **Chat** nav item toggle the drawer,
  remove the `/chat` route + `ChatPage` + legacy client functions/query keys. Backend untouched
  (legacy routes go dormant). Low risk, reversible. Verify: web typecheck, `pnpm build:web`,
  e2e/manual — the drawer opens from any page, persists its transcript across navigation, and
  send/stream/New-chat/history all work.
- **Phase B — Backend (own PR):** remove legacy routes, worker job, `TmuxBridgeAdapter`,
  legacy repo methods + shared schemas + legacy tests; retain `HttpApiAdapter` substrate with a note.
  Verify: `pnpm verify:foundation` + `pnpm audit:release-hardening` green.

## 8. Risks & open questions

- **`HttpApiAdapter` becomes unreferenced after Phase B.** Mitigation: explicit retention note; it is
  covered by its own adapter tests so it can't silently rot. (Alternative considered and rejected by
  owner: delete now, recover from git history at tie-in time.)
- **`createChatAdapter` factory** may end up with only the (removed) CLI branch + the kept HTTP
  branch. If nothing consumes the factory after the worker job is gone, remove the factory and
  construct `HttpApiAdapter` directly at the future tie-in; confirm during Phase B impl.
- **pg-boss chat queue/grants (0036/0037)** are left in place (removing a queue is not worth a new
  migration; harmless if unused). Flag if a later cleanup wants them gone.
- **Shared-DB test hazard:** integration runs reset the dev DB — coordinate before running them while
  someone is manually testing (lesson from this session).

## 9. Verification

- Phase A: `pnpm typecheck`, `pnpm build:web`, manual/e2e of the Chat page (open, send, stream,
  New chat resets, history, reload).
- Phase B: `pnpm verify:foundation` (lint, format, file-size, typecheck, migrate, integration) +
  `pnpm audit:release-hardening`, both green. Grep confirms no remaining references to removed
  symbols (`appendUserMessage`, `TmuxBridgeAdapter`, removed routes/schemas).
