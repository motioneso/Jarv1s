# Onboarding & provider-setup UX follow-ups

Captured 2026-06-20 during the v0.1.1 local deploy + chat E2E (#342 / #362 / #363).

## North-star goal

**A primary user (Ben) should complete the entire path from the UI after running only
`install.sh`** — onboard → choose a provider → install its CLI → log in → get a working
chat-capable model → chat — with **no manual API calls, scripts, or admin-settings detours**.
Today several of those steps only exist as backend routes or buried admin flows; the E2E only
worked because the operator drove `provider-install` / `provider-login` / model-config by hand.

## Gaps found (priority order)

### 1. Onboarding provider step is detect-only — can't install/login from the UI (BLOCKER for the goal)

The "Assistant" step only _detects_ host CLIs and offers a "Test login" status check. There is no
way to **select a provider, install its CLI, or log in** from onboarding — those are working
backend routes (`/api/onboarding/provider-install`, `/provider-login/begin|submit-token|poll`)
that nothing in the UI calls. **Wire them in:** pick provider → Install → Login (show the OAuth
URL, accept the pasted code) → done, all in the wizard.

### 2. herdr is offered in onboarding but isn't actually available — hide it

The Control-channel step lists **herdr** as a choice even though it's "Not installed" and not a
real option in this deploy (the cli-runner uses bundled tmux). Showing an unselectable/unavailable
option is confusing. **Hide herdr** (or only show multiplexers actually available), and reconsider
whether this step needs to be user-facing at all when the container always uses tmux.

### 3. No chat-capable model after login — user must hand-build one in Admin (Ben dislikes this flow)

After install+login, chat fails with _"No active chat-capable model is configured."_ The only way
to fix it is **Admin → Assistant & AI → Add provider → Add model**, manually typing a model id and
ticking capabilities. A primary user shouldn't need to. **Options:** auto-register a sensible
default chat-capable model when a provider is logged in; and/or land the "Discover" (auto-detect
models) button so the user picks from real models instead of typing an id.

### 4. The add-provider / add-model flow is API-key-shaped and clunky for CLI providers

"Add provider" then a separate "Add model" card, with a model-id free-text field. For a CLI
provider there's no API key, but the flow reads like the HTTP-API-provider config. Clarify the two
kinds, and for CLI providers skip the credential framing entirely. (Note: the model-id is largely
decorative for CLI chat — claude used the account's default `Sonnet 4.6` regardless of the
`claude-sonnet-4-5` id entered.)

### 5. Once chat works, let the user ask Jarvis for help with the rest of setup

After a provider is connected and chat is live, onboarding should offer **"ask Jarvis"** — the
assistant can then guide the remaining configuration conversationally (Ben's idea). This only makes
sense after gaps #1 and #3 are closed.

### 6. "Skip setup" drops the user into a dead-end chat

Skipping onboarding lands on Today with a chat that can't answer (no provider/model). Either keep
onboarding's provider step unskippable-until-connected, or make the empty chat explain how to
connect a provider (and link straight to it).

## Backend pieces that already work (just not surfaced)

- `provider-install` → installs the pinned CLI into the cli-runner volume (#362).
- `provider-login` begin/submit/poll → real OAuth, token captured + persisted, settles `ready` (#363).
- Chat → with a configured model, the cli-runner launches the authenticated CLI and streams a real
  reply (verified: "I'm running on Claude Sonnet 4.6"). First-run onboarding/trust is auto-seeded
  (#342 provider-first-run).
