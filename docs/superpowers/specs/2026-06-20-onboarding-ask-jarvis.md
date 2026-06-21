# Spec — onboarding: offer "ask Jarvis" once chat is live (#368)

**Status:** DRAFT (interview-aligned 2026-06-20). Needs sign-off before build.
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
- At the Finish step (`onboarding-wizard.tsx` FinishStep), add an **"Ask Jarvis"** primary action
  that completes onboarding and opens the chat drawer (the existing "Chat with Jarvis" surface) with
  a **starter prompt / suggestion** geared to setup (e.g. "Help me finish setting up Jarvis" or the
  existing suggestion chips). Reuse the existing chat drawer + live-chat routes; no new chat surface.
- Keep the normal "Finish / go to Today" path for users who don't want to chat yet.

## Test plan

- Unit (web): the "Ask Jarvis" action renders only when chat is available; it completes onboarding
  and opens the chat drawer with the starter prompt; hidden when no provider is connected.

## Open questions for sign-off

1. Is "Ask Jarvis" a Finish-step button, or also an inline nudge right after a provider connects?
   (Draft: Finish-step primary action; keep it simple.)
2. Starter prompt wording + whether it pre-fills vs just opens an empty chat. (Draft: open the
   drawer with a setup-oriented suggestion chip, don't auto-send.)
