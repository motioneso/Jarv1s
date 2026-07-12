# Chat model selector in chat (#759)

**Status:** Approved (2026-07-07, Ben)
**Date:** 2026-07-05
**Tier:** routine
**Builds on:** the existing chat model override feature — `packages/ai/src/chat-model-override.ts`
(`resolveChatModelOverride`), `AiRepository.getChatModelOverridePreference` /
`setChatModelOverridePreference` (`packages/ai/src/repository.ts`), routes
`GET`/`PUT /api/ai/chat-model-override` (`packages/ai/src/routes.ts`), and the current Settings UI
at `apps/web/src/settings/settings-ai-pane.tsx` (`ChatModel` component). It also builds on existing
admin/provider infrastructure: configured model rows already carry `providerId`
(`packages/ai/src/repository.ts`, `CreateAiProviderInput` / provider linkage on
`ai_configured_models`), provider model discovery already exists through
`ModelDiscoveryService.discoverModels` and `GET`/`POST /api/ai/providers/:id/.../discover-models`
(`packages/ai/src/provider-validation-routes.ts`), and capability pinning already exists through
`PUT /api/ai/capability-routes/:capability` (`packages/ai/src/capability-route-routes.ts`).

## Problem

A user can already choose which model answers their chats — but only by leaving the conversation
and going to **Settings → AI → Chat model**, where a dropdown lets them pick an
`allowUserOverride`-enabled model or fall back to the instance default. That preference
(`chat.modelOverride`) is a single sticky per-user setting, resolved by the router wherever a
feature requests the `chat` capability — it is not read as a per-turn parameter, and
`POST /api/chat/turn` never receives a model ID.

Issue #759 asks for this control to live directly in the chat surface. The important product line
is provider identity:

- Selecting a different model from the same provider as the current chat's model behaves like a
  CLI `/model` command. The current thread continues; subsequent answers come from the newly
  selected model.
- Selecting a model from a different provider starts a new chat session under that provider/model.
  The current thread's context/history does not carry over. This is a hard technical/product line,
  not a preference.

Grounding note: today the executing model is bound at engine launch only. `ChatSessionManager.launchSession`
passes `--model` when the engine starts (`packages/chat/src/live/chat-session-manager.ts`, #367),
`ensureSession` returns an existing engine untouched, and the sticky preference is read only by
`resolveActiveProvider` at launch time. There is no live-engine path that re-reads the preference
mid-session, so persisting the preference alone changes nothing for the running chat. Achieving the
same-provider "thread continues, next answer uses the new model" promise therefore requires an
explicit switch mechanism — decided as relaunch-with-replay; see Resolved decisions.

The admin side also has shipped pieces that are not yet exposed as the primary workflow for chat:
admins can discover provider models through live provider APIs, and admins can pin a specific model
to the `chat` capability instance-wide. The gap is UI/workflow glue, not a new model-resolution
architecture.

## Scope

- Add a compact, chat-input-adjacent model selector to the chat drawer
  (`apps/web/src/chat/chat-drawer.tsx`). It should be a simple field/pill with a drop-up selection
  near the message composer, in the spirit of Claude Desktop, ChatGPT Desktop, and Hermes Desktop
  inline model pickers. It is not a chat-header dropdown and not a Settings-style control.
- Source the selector from the same chat-model-override data path Settings uses today. Provider
  identity requires no new DTO plumbing: `aiConfiguredModelSchema` already carries
  `providerConfigId` and `providerKind` (`packages/shared/src/ai-api.ts`), and the override-settings
  response embeds full model rows for the default, selected, and selectable models — so
  same-vs-cross-provider comparison is `providerConfigId` equality over data the client already
  receives. Expect zero (or near-zero) DTO/schema additions.
- Same-provider selection:
  1. Persists the selected `modelId` through the existing `PUT /api/ai/chat-model-override`
     mutation.
  2. Keeps the current chat thread open, like sending `/model` in a CLI session. Persistence alone
     is not sufficient (the model binds at engine launch — see the grounding note in Problem); the
     thread-continues behavior is delivered by relaunch-with-replay through the existing
     `POST /api/chat/switch` path (see Resolved decisions).
- Cross-provider selection:
  1. Shows a clear warning/confirmation before changing anything: the current thread's context does
     not carry over and a new chat will start under the selected provider/model.
  2. On confirmation, persists the selected `modelId` through the existing
     `PUT /api/ai/chat-model-override` mutation.
  3. Starts a new chat using the existing drawer flow (`clearChat()` + `props.clearRecords()` +
     invalidate `queryKeys.chat.threads`), so the next message begins under the newly selected
     provider/model.
- Private/incognito chats (#744, revised the same day: private chats are fully ephemeral — no
  `chat_messages` rows, session destroyed on end, nothing recoverable) use the identical selector,
  with two honesty requirements: a cross-provider switch starts a new chat, which **permanently
  destroys the active private session** — the confirmation copy must say so when the current chat is
  private; and because the same-provider mechanism is relaunch-based (see Resolved decisions), a
  same-provider switch inside a private chat also loses all conversational context, because private
  threads never have rows to replay. The selector must degrade honestly in private chats rather than
  imply continuity it cannot deliver.
- Keep the existing Settings → AI "Chat model" user control working. The chat selector is the
  direct in-conversation entry point to the same user preference.
- Add admin UI/workflow glue for provider models and chat capability selection:
  - Let admins turn discovered provider models into usable `ai_configured_models` rows without
    manual one-by-one `POST /api/ai/models` work for every model they want available.
  - Expose the existing `PUT /api/ai/capability-routes/:capability` pinning path as the primary
    admin UX for choosing the instance-wide `chat` model directly, bypassing the
    interactive/reasoning/economy tier ladder for chat when pinned.
  - **Reconcile the two existing admin pinning mechanisms without inventing a third.** An admin
    chat-model-override pin already exists alongside capability routes:
    `PUT /api/admin/ai/chat-model-override` (`packages/ai/src/routes.ts`) sets
    `adminPinnedModelId`, which disables the user override entirely
    (`getChatModelOverrideSettings` returns `selectableOverrideModels: []` and the user `PUT`
    responds 409). Current resolution precedence — admin pin → user override → capability-route /
    tier default — stays unchanged. The admin UI must present both mechanisms coherently, and the
    in-chat selector must render the admin-pinned state as locked (covered by the locked/empty
    acceptance criterion).
- Leave background/non-chat jobs on the existing capability/tier machinery. For example,
  `summarization` at the `economy` tier should continue resolving through the platform default path.

## Non-goals / Guardrails

- **No model-resolution rearchitecture.** Provider discovery, configured model creation, capability
  routes, user overrides, and tier fallback already exist. This issue wires those paths into the
  right chat/admin UX; it does not replace them.
- **No router bypass.** The chat selector must read its selectable model list from the AI package's
  existing override/capability data paths. No model IDs may be hardcoded in chat UI/route code.
- **No new configured-model schema.** Provider comparison uses existing configured model/provider
  linkage (`providerId` on `ai_configured_models`). Do not add a parallel provider identity model
  just for chat switching.
- **No new secret surface.** It is acceptable to expose non-secret provider identity needed for
  same-provider vs cross-provider switching. Do not expose credential, API key, raw provider-auth
  detail, or any other secret in frontend DTOs.
- **No per-turn model parameter.** Do not add a `modelId` field to `POST /api/chat/turn` or thread
  it through `packages/chat`'s routes. The override stays a sticky preference resolved inside
  `packages/ai` when the `chat` capability is requested.
- **No thread/message schema change for this issue.** Do not add a "model used" column to threads
  or messages to make this work. If a future requirement needs per-thread model history, that is a
  separate spec.
- **No proactive capability-mismatch warning.** If the user asks the selected model to do something
  it cannot do, such as vision on a text-only model, the chat/model should answer that it is not
  capable when asked. Do not build separate warning UI for this.
- **Do not remove tier fallback.** Admin chat pinning can bypass the tier ladder for `chat`, but the
  tier ladder remains the default platform path for background/non-chat capabilities and for chat
  when no direct chat pin applies.

## Resolved decisions

- Same-provider model changes continue the current thread. **Mechanism (decided 2026-07-05):
  relaunch-with-replay.** After the `PUT`, the client calls the existing engine switch path
  (`POST /api/chat/switch` → `ChatSessionManager.switchProvider`: kill + relaunch), and
  switch-triggered relaunches force the launch replay batch (rolling summary + recent turns via
  `listPriorTurns`) even though `JARVIS_CHAT_REPLAY_K` defaults to 0. This is explicitly not literal
  in-CLI `/model` injection — that remains a possible later per-provider enhancement where a CLI
  supports it. Context is approximated by replay rather than perfectly continuous; private chats
  have nothing to replay, by design (see the incognito scope bullet for the honesty requirement).
- Cross-provider model changes require a confirmation and then start a new chat; they are not
  silent resets and not hard blocks.
- The selector belongs near the composer as an inline/drop-up control, not in the header row.
- Incognito uses the same selector behavior as normal chat.
- Capability mismatch is handled by the selected model/chat response, not by preflight UI.
- Admin work is in scope only as workflow/UI glue around existing discovery, configured model, and
  capability-route mechanisms.

## Open questions

The same-provider switch mechanism was decided by Ben on 2026-07-05 (relaunch-with-replay; see
Resolved decisions). Remaining open items are UI-design details only:

- Exact warning copy for the cross-provider confirmation dialog.
- Exact visual shape of the composer-adjacent field/pill and drop-up menu, within the existing chat
  drawer design language.

## Acceptance criteria for future build

- A compact model selector is visible near the chat composer, not only in Settings → AI and not in
  the chat drawer header.
- The selector lists the instance default plus eligible configured chat models, sourced from the AI
  package's existing chat override/capability data paths, with provider identity available for
  switching decisions.
- Selecting a model from the same provider persists the preference through
  `PUT /api/ai/chat-model-override` and keeps the current thread open; the next assistant answer in
  that thread uses the newly selected model, delivered via relaunch-with-replay through
  `POST /api/chat/switch` — preference persistence alone is insufficient because the model binds at
  engine launch.
- A switch-triggered relaunch includes the replay batch (rolling summary + recent turns) even when
  `JARVIS_CHAT_REPLAY_K` is 0, so a same-provider switch retains approximate context instead of
  silently resetting like a cross-provider switch.
- Selecting a model from a different provider shows a confirmation first. Confirming persists the
  preference through `PUT /api/ai/chat-model-override` and starts a new chat using the existing
  drawer reset flow.
- Incognito chats expose the same selector and same switching behavior; per revised #744 they are
  fully ephemeral, and the cross-provider confirmation shown inside a private chat states that the
  private session will be permanently destroyed.
- Admin pin precedence (admin chat-model-override pin → user override → capability route / tier
  default) is unchanged, and the admin-pinned state renders as locked in both Settings and the
  in-chat selector.
- Admin AI settings let an admin import/use discovered provider models as configured models without
  one-by-one manual model creation for each desired model.
- Admin AI settings expose direct `chat` capability model pinning through the existing
  `PUT /api/ai/capability-routes/:capability` mechanism as the primary chat model selection path,
  while preserving tier fallback for background/non-chat capabilities.
- When override is disabled by the admin or no default model is configured, the in-chat selector
  reflects that state without erroring, matching the existing locked/empty patterns already in
  `settings-ai-pane.tsx`.
- No new provider SDK call from the chat UI, no hardcoded model list, no credential/secret field
  added to frontend responses, no `modelId` added to `POST /api/chat/turn`, and no thread/message
  schema change.
- The existing Settings → AI chat model user control continues to work.
- `pnpm verify:foundation` passes for the eventual implementation PR.
