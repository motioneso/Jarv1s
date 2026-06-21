# Spec — onboarding: "Skip setup" must not dead-end into an unusable chat (#369)

**Status:** DRAFT (interview-aligned 2026-06-20). Needs sign-off before build.
**Tracks:** #369. Part of #342. Same onboarding/Today surface as #365 (collision — sequence).

## Problem

"Skip setup" (`onboarding-wizard.tsx` → `POST /api/onboarding/skip` → `/today`) drops the founder
into Today with a chat that **can't answer** (no provider/model → "No active chat-capable model is
configured"). Silent dead-end: nothing tells the user why or how to fix it.

## Decision (locked in interview — gating option ii)

Onboarding stays **skippable** (don't trap the user), but the skip is **honest**: a clear
consequence at skip time **and** a one-click path back from the empty chat. No silent dead-end.

## Design

- **At skip:** if no provider is connected, the "Skip setup" confirmation states the consequence —
  _"Chat won't work until you connect a provider. You can do it later in Settings."_ — and proceeds
  only on confirm. (Keep the existing skip route + state; this is UI-only.)
- **Empty-chat explainer:** when chat has no active model, the Today chat surface (and the chat
  drawer empty state) shows _"Connect a provider to start chatting"_ with a **direct link** to the
  onboarding provider step / Admin → Assistant & AI, instead of a raw error. Derive "no model" from
  the same chat-availability signal used in #365/#368 (don't surface the raw 400 string).
- This complements #365's gating (Continue enabled once connected); skip is the explicit
  "not now" path.

## Test plan

- Unit (web): skip with no provider connected shows the consequence copy + requires confirm; the
  empty chat (no active model) renders the connect-a-provider explainer + link, not the raw error.
- Integration: the chat surface maps the "no active chat-capable model" 400 to the friendly empty
  state.

## Open questions for sign-off

1. Block skip until confirmed, or allow skip freely and rely solely on the empty-chat explainer?
   (Draft: a one-line consequence on the skip confirm + the explainer — both, low cost.)
2. Where does the empty-chat "connect a provider" link point — re-enter onboarding, or deep-link to
   Admin → Assistant & AI? (Draft: re-enter the onboarding provider step for the founder; Admin for
   later/non-founder.)
