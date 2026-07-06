# Chat Voice Input and Transcription (#738)

**Status:** approved
**Issue:** #738
**Author:** Codex, grill-me with Ben - 2026-07-04

## 1. Problem

Chat settings mention Voice input, but voice capture/transcription crosses browser permission,
provider routing, privacy, and data-retention boundaries. It needs its own implementation spec.

## 2. Decisions

- V1 uses tap-to-record / tap-to-stop, not press-and-hold.
- Transcription is server-side through a provider-agnostic AI capability route.
- Add a transcription capability that can target local endpoints such as Whisper/Parakeet or
  hosted providers such as Groq.
- Do not store raw audio after transcription.
- Transcript text appears in the composer for review/edit before sending.
- No arbitrary product duration cap. Server/proxy upload size and timeout limits still apply and
  return clear errors.
- The mic button can be visible once the feature exists, but disabled until transcription is
  configured and healthy. Tooltip explains setup.
- AI/provider settings owns transcription provider setup. Chat settings can link to it and show
  status.
- Voice is available automatically when configured; no extra Chat toggle.
- Denied microphone permission is browser/device state, not persisted Jarv1s state.
- Once inserted into the composer, transcript text follows the exact typed-message path.

## 3. Scope

- Add transcription as a provider-routed AI capability.
- Add server route for transient audio upload/transcription.
- Add Chat composer mic control with tap-to-record, tap-to-stop, recording state, errors, and
  disabled/setup tooltip.
- Insert completed transcript into the composer, not directly into chat.
- Add setup/status link from Chat settings to AI/provider settings.
- Ensure raw audio is not logged, stored, placed in job payloads, or sent to memory.

## 4. Non-Goals

- Client/browser-local transcription.
- Storing audio.
- Auto-sending transcripts.
- Continuous dictation or wake-word behavior.
- Voice commands outside chat.

## 5. Acceptance

- Mic control is disabled with a helpful tooltip when transcription is not configured.
- With a configured transcription route, the user can record and receive editable transcript text
  in the composer.
- Raw audio is transient and absent from durable storage, logs, job payloads, and memory.
- Denied microphone permission shows an inline/device-level error without persisting app state.
- Tests cover provider routing, transcript insertion, and no raw-audio persistence/logging seams.

## 6. Files In Play

- `~/Jarv1s/apps/web/src/chat/*`
- `~/Jarv1s/apps/web/src/settings/settings-module-subviews.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-ai-*`
- `~/Jarv1s/packages/ai`
- `~/Jarv1s/packages/chat`
- `~/Jarv1s/packages/shared/*ai*`
