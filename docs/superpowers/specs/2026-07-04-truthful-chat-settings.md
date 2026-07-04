# Truthful Chat Settings (#737)

**Status:** approved
**Issue:** #737
**Author:** Codex, grill-me with Ben - 2026-07-04

## 1. Problem

Chat settings currently display local-only controls that reset on reload and do not affect runtime
behavior. Several controls duplicate settings that should be owned elsewhere.

## 2. Decisions

- Chat does not own automation. Chat executes/surfaces actions according to the target
  module/action policy.
- Remove the Chat "suggested actions" setting. Module-owned action settings decide whether an
  action is off, suggested, or automatic.
- Keep a real response length/style preference if it maps to chat runtime behavior.
- Remove "stream responses"; this is transport/API behavior and not useful in the current product.
- Remove persistent "remember across conversations"; remembering is default behavior.
- Private/incognito chat is a separate feature tracked by #744.
- Voice input can appear as tracked/setup status in Chat settings, but implementation belongs to
  #738.
- Chat settings can stay small for now.

## 3. Scope

- Persist and apply a response style/length setting, e.g. concise / balanced / detailed.
- Remove or convert fake controls:
  - suggested actions: remove.
  - stream responses: remove.
  - remember across conversations: remove.
  - voice input: show as coming soon/tracked by #738, not a working toggle.
- Remove `NotWired` and local `DEFAULT_CHAT` as the source of truth.
- Keep cache/query updates coherent after saving response preference.

## 4. Non-Goals

- Voice recording/transcription (#738).
- Private/incognito chat (#744).
- Module action automation controls.
- Provider/admin model configuration; Chat settings may link to AI settings but does not duplicate
  provider setup.

## 5. Acceptance

- Changing response style/length survives reload.
- Chat runtime uses the saved response style in generated answers.
- No visible Chat setting appears to work when it does not.
- Voice input is either a tracked coming-soon/status row or absent until #738.
- Tests cover preference persistence and at least one runtime prompt/behavior effect.

## 6. Files In Play

- `~/Jarv1s/apps/web/src/settings/settings-module-subviews.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-sample-data.ts`
- `~/Jarv1s/packages/chat/src/routes.ts`
- `~/Jarv1s/packages/chat/src/live/*`
- `~/Jarv1s/packages/shared/*chat*`

