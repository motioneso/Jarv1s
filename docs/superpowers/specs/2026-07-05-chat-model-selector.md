# Chat model selector in chat (#759)

**Status:** Proposed — awaiting Ben's approval
**Date:** 2026-07-05
**Tier:** routine
**Builds on:** the existing chat model override feature — `packages/ai/src/chat-model-override.ts`
(`resolveChatModelOverride`), `AiRepository.getChatModelOverridePreference` /
`setChatModelOverridePreference` (`packages/ai/src/repository.ts`), routes
`GET`/`PUT /api/ai/chat-model-override` (`packages/ai/src/routes.ts`), and the current Settings UI
at `apps/web/src/settings/settings-ai-pane.tsx` (`ChatModel` component). This is shipped and working
today, just not surfaced in the chat UI itself.

## Problem

A user can already choose which model answers their chats — but only by leaving the conversation
and going to **Settings → AI → Chat model**, where a dropdown lets them pick an
`allowUserOverride`-enabled model or fall back to the instance default. That preference
(`chat.modelOverride`) is a single sticky per-user setting, resolved by the router wherever a
feature requests the `chat` capability — it is not read as a per-turn parameter, and
`POST /api/chat/turn` never receives a model ID.

Issue #759 asks for this control to live directly in the chat surface, and specifies a stronger
behavior than the Settings pane currently has: changing the model should start a new chat, not
just change what powers the rest of the current thread.

## Scope

- Add a model selector to the chat drawer (`apps/web/src/chat/chat-drawer.tsx`), sourced from the
  same data the Settings pane already fetches from `GET /api/ai/chat-model-override`
  (`defaultModel`, `selectableOverrideModels`, `overrideEnabled`, `currentOverrideModelId`) — no new
  backend endpoint, no new model-listing logic.
- Selecting a model in the chat header does two things, both using existing machinery:
  1. Calls `PUT /api/ai/chat-model-override` with the chosen `modelId` (same mutation
     `settings-ai-pane.tsx` already uses) to persist it as the user's override preference.
  2. Runs the existing `startNewChat()` flow already wired to the drawer's "New chat" button
     (`clearChat()` + `props.clearRecords()` + invalidate `queryKeys.chat.threads`), so the next
     message starts a fresh thread under the newly selected model.
- Reuse the existing `Select` control pattern and `jds-*` styling from `settings-ai-pane.tsx`'s
  `ChatModel` component rather than inventing a new dropdown primitive.
- Mirror the Settings pane's existing locked/empty states: if `overrideEnabled` is `false` (admin
  has disabled override) or no `defaultModel` is configured, the in-chat selector reflects that
  (read-only / hidden) rather than introducing new UI states.
- Leave the Settings → AI "Chat model" control in place, unchanged — this issue adds a second,
  more convenient entry point to the same preference, it does not replace the existing one.

## Non-goals / Guardrails

- **No router bypass.** The selector must read its model list only from the existing
  `GET /api/ai/chat-model-override` response (`allowedModels` / `selectableOverrideModels`). No
  model IDs may be hardcoded in chat UI/route code — this is the same set already gated by the
  admin's per-model `allowUserOverride` flag (`settings-ai-admin-pane.tsx`) and the instance
  `CHAT_MODEL_OVERRIDE_SETTING_KEY` toggle.
- **No new secret surface.** The selector must not add any field to
  `serializeChatModelOverrideSettings`'s output beyond what already reaches the frontend today —
  no credential, API key, or raw provider-auth detail. Verify the DTO isn't widened while wiring
  this up.
- **No per-turn model parameter.** Do not add a `modelId` field to `POST /api/chat/turn` or thread
  it through `packages/chat`'s routes. The override stays a sticky preference resolved inside
  `packages/ai` when the `chat` capability is requested — duplicating that resolution in
  `packages/chat` would violate module isolation (chat would be reaching into AI's routing job).
- **No thread/message schema change.** Do not add a "model used" column to threads or messages to
  make this work — the existing new-chat-then-message flow doesn't require one. If a future
  requirement needs per-thread model history, that's a separate spec.
- **Out of scope:** the admin pane's `allowUserOverride` / instance `overrideEnabled` controls
  (`settings-ai-admin-pane.tsx`) are untouched by this issue.

## Open questions

- Does "start a new chat" mean the existing client-side `startNewChat()` reset (a thread is only
  created lazily server-side on first message), or must a new thread row be created eagerly at
  selection time — e.g., so an empty "chat with Model X" appears in history even if the user never
  sends a message?
- Model choice is stored as a single global `chat.modelOverride` preference — is that sufficient
  (picking a model always becomes the new default for all future new chats too), or does the issue
  intend a "just for this one chat" scope distinct from "always use this model" that the current
  data model doesn't support?
- If the user is mid-thread (has already sent messages) and opens the in-chat selector, should
  switching models be blocked, warned ("this will start a new chat and lose this conversation's
  context"), or just always trigger the new-chat reset silently, same as the "New chat" button
  today?
- How should the selector handle a model that lacks a capability the current conversation relied on
  (e.g., vision on an upload-heavy thread) — rely purely on the existing `capabilities.includes`
  filtering in `resolveChatModelOverride`/`isActiveChatModel` (model simply isn't listed), or show
  an explicit warning?
- Where does the control fit in the already-populated chat drawer header (`BrandMark`, name/status,
  "New chat", "History", "Close")? Inline dropdown next to those icon buttons, a secondary header
  row, or an overflow/kebab menu?
- Should incognito chats (`clearChat({ incognito: true })`) interact with the in-chat selector at
  all, or is the selector only relevant to normal (persisted) chats?

## Acceptance criteria for future build

- A model selector is visible directly in the chat drawer, not only in Settings → AI, listing the
  same models Settings already shows (instance default + any `allowUserOverride` models) sourced
  from the existing `GET /api/ai/chat-model-override` response.
- Selecting a different model in chat persists the preference (`PUT /api/ai/chat-model-override`)
  and starts a new chat, matching today's "New chat" button behavior, so the next message is
  answered by the newly selected model.
- When override is disabled by the admin or no default model is configured, the in-chat selector
  reflects that state without erroring, matching the existing locked/empty patterns already in
  `settings-ai-pane.tsx`.
- No new provider SDK call, no hardcoded model list, and no credential/secret field added to any
  response reaching the frontend.
- The existing Settings → AI chat model control continues to work unchanged.
- `pnpm verify:foundation` passes for the eventual implementation PR.
