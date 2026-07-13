# Private chat and history trust hardening (#984)

**Status:** Draft for Ben approval
**Date:** 2026-07-12
**Tier:** security (privacy, session lifetime, and retained-data claims)
**Builds on:** #744, #868, #508, `2026-07-05-private-chat-mode.md`

## Problem

The shipped private-chat implementation has the right no-write design, but the dogfood pass exposed
two trust gaps and one unusable history model:

- starting private mode is fire-and-forget in the web client, so an immediate message can race the
  server transition and land on the ordinary thread;
- an explicit history resume can launch with no prior context because normal cold replay defaults to
  zero;
- History mixes its list with the ordinary empty composer, splits open and resume into different
  actions, and is difficult to read.

The walkthrough could not prove that the listed conversation was the just-ended private chat. Treat
that as a security acceptance question, not as evidence for a second private-chat implementation.
Open issue #868 remains the precise owner of the known Gemini/non-interactive transcript-cleanup gap.

## Decisions

1. **Incoming context is allowed; outgoing retention is not.** A private chat may read the user's
   existing RLS-permitted Jarv1s context through the same provider-agnostic context seams as an
   ordinary chat. Private turns never become chat history, memory, replay input, or future context.
2. **Action records stay minimal and truthful.** An action triggered from private chat keeps only the
   owning module's normal minimum audit/action record. The chat transcript and surrounding prompt are
   not copied into that record. UI copy says: "This chat isn't saved. Actions you take still leave
   activity and audit records."
3. **Private activation is server-confirmed and atomic.** The client does not show private mode or
   enable sending until the server has created/confirmed the incognito session. Failure restores the
   prior ordinary state and shows a recoverable error. The server is the source of truth after reload
   or remount; local React state alone must not decide whether a session is private.
4. **History rows continue conversations.** Selecting a conversation opens its stored messages and
   makes it the active conversation. The composer remains available and the next message continues
   that conversation. Remove the separate Play/Resume split and the read-only review mode.
5. **Explicit resume forces bounded replay.** Resume reuses the existing forced-replay mechanism and
   its existing bounded cap; it does not depend on `JARVIS_CHAT_REPLAY_K` and does not add another
   replay system.
6. **History is an exclusive surface.** While History is open, show a readable conversation list or
   its own empty/loading/error state, not the ordinary "What can I help with?" composer seeds. Use
   existing design tokens and authored chat patterns at desktop and narrow widths.
7. **Cross-engine acceptance depends on #868.** #984 does not duplicate provider transcript cleanup.
   Final privacy acceptance waits for #868 to land and covers every supported engine.

## Scope and order

### Slice 1 — private-session truth

- Make private start await a server-confirmed incognito session before enabling send.
- Expose/restore enough server state for the client to render private mode truthfully after remount.
- Prove private requests can read existing permitted context without writing the private turn into
  history or memory.
- Keep the existing private cleanup design; do not add a second retention mechanism.

### Slice 2 — reliable continuation

- Reuse the existing forced-replay path for explicit resume.
- Make selecting a history row activate that thread and show its stored messages.
- Keep owner-scoped lookup and existing not-found behavior; never broaden RLS or admin access.

### Slice 3 — history presentation

- Make the list exclusive, readable, keyboard accessible, and responsive.
- Remove the separate Play button and read-only review banner.
- Keep dates, contrast, spacing, loading, empty, and error states tokenized.

### Slice 4 — acceptance

- Land #868 first.
- Verify private end, refresh, re-login, two-tab lifetime, and every supported engine.
- Run a desktop and narrow-viewport walkthrough against the deployed build.

## Likely path locks

- Frontend/history: `~/Jarv1s/apps/web/src/chat/chat-drawer.tsx`,
  `~/Jarv1s/apps/web/src/api/client.ts`, `~/Jarv1s/apps/web/src/styles/kit-chat.css`, and focused
  chat drawer tests.
- Session/resume: `~/Jarv1s/packages/chat/src/live/chat-session-manager.ts`, persistence and live
  routes, plus their focused tests.
- #868 owns private transcript cleanup/runtime paths.

Serialize frontend work with #985 if it touches the chat drawer or action cards. #979 is test-only
and should remain independent unless its transport test is refactored.

## Non-goals

- Durable private history, resumable private threads, or a delete-any-conversation feature.
- A second memory-suppression or transcript-cleanup system.
- Unbounded replay, full-session transcript injection, or changing normal cold-start replay.
- New provider-specific context plumbing.

## Acceptance

- [ ] Sending cannot race private activation onto an ordinary thread.
- [ ] Reload/remount renders private state from server truth and never silently downgrades it.
- [ ] Private chat can answer from existing permitted Jarv1s context.
- [ ] After private end and refresh/re-login, its thread/messages are absent from history and memory.
- [ ] Module actions retain only their normal required audit/action record; private transcript text is
      absent from it.
- [ ] Selecting a history row opens and activates it; the next message continues with bounded prior
      context even when `JARVIS_CHAT_REPLAY_K=0`.
- [ ] History never renders ordinary composer seeds beneath its list.
- [ ] The list, loading/empty/error states, and active conversation are readable and keyboard usable
      at desktop and narrow widths.
- [ ] #868 is closed and cross-engine privacy checks pass before #984 closes.
- [ ] Security-tier QA posts its verdict; Ben explicitly signs off before merge.
