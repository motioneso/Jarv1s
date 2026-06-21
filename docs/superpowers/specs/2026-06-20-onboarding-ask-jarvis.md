# Spec — onboarding: offer "ask Jarvis" once chat is live (#368)

**Status:** APPROVED 2026-06-20 (Ben — Finish-step only; starter prompt = "check my setup").
**Tracks:** #368. Part of #342. **Depends on #365 (provider connect) + #367 (auto-registered chat
model)** — only meaningful once chat actually works.

## Problem

Once a provider is connected and chat works, the natural next move is to let the user **ask Jarvis
for help with the rest of setup** rather than hunt through settings. Today onboarding ends at a
generic Finish with no bridge into the now-working assistant.

## Decision (locked in interview)

After a provider is connected (chat live), surface an **"Ask Jarvis"** affordance so the user can
finish configuration conversationally. Appears at **Finish** (and/or right after the provider card
flips to "Connected · chat ready").

## Design

- Gate the affordance on **chat being available** (≥1 provider `ready` + an active chat model —
  derivable from the extended onboarding status in #365/#367). If chat isn't available, don't show
  it (no dead button).
- At the Finish step (`onboarding-wizard.tsx` FinishStep) **only** (no inline nudge), add an
  **"Ask Jarvis"** primary action that completes onboarding and opens the chat drawer (the existing
  "Chat with Jarvis" surface) with a **setup-check starter** — a suggestion chip like _"Check my
  setup"_ / _"Help me verify my Jarvis setup"_ (Ben). Reuse the existing chat drawer + live-chat
  routes; no new chat surface.
- Keep the normal "Finish / go to Today" path for users who don't want to chat yet.

## Test plan

- Unit (web): the "Ask Jarvis" action renders only when chat is available; it completes onboarding
  and opens the chat drawer with the setup-check starter; hidden when no provider is connected.

## Resolved (2026-06-20)

1. **Finish-step button only** (no inline post-connect nudge).
2. Starter is a **setup-check** suggestion (e.g. "Check my setup") — opens the drawer with the chip;
   does not auto-send.
