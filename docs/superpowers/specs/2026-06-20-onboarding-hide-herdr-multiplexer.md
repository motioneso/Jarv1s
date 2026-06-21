# Spec — onboarding control-channel: hide the unavailable herdr option (#366)

**Status:** DRAFT (interview-aligned 2026-06-20). Needs sign-off before build.
**Tracks:** #366. Part of #342. Same onboarding surface as #365/#369 (collision — sequence on the
wizard files).

## Problem

The "01 Control channel" step (`apps/web/src/onboarding/multiplexer-step.tsx`, OPTIONS line ~25)
offers **herdr** as a multiplexer choice even though it's "Not installed" and **not a real option**
in the deployed container — the cli-runner sidecar always uses bundled **tmux**. Presenting an
unselectable/irrelevant option is confusing and makes the step look like it needs a decision it
doesn't.

## Decisions (locked in interview)

1. **Hide herdr** in onboarding (Ben). Don't offer a multiplexer the deploy can't use.
2. Since the container always uses tmux, the control-channel step should **auto-select tmux and
   de-emphasize itself** (no real decision for the user) rather than present a chooser.

## Design

- In `multiplexer-step.tsx`: render only **available** multiplexers (drop herdr from OPTIONS, or
  filter by the host-usable flags already in `OnboardingMultiplexerStepDto`:
  `tmuxUsable`/`herdrUsable`). In the standard container, that leaves tmux/Auto only.
- Auto-select the working multiplexer (Auto/tmux) and present the step as an informational
  "Jarvis runs commands inside a single inspectable tmux session" confirmation rather than a
  chooser. Keep the existing `setChatMultiplexerSettings` call (PUT `/api/admin/chat-multiplexer`)
  for the selected value.
- Optional (confirm in sign-off): if only one multiplexer is usable, **collapse/skip** the step in
  the rail so the founder isn't asked to decide a non-decision.
- Backend `OnboardingFounderStatus.steps.multiplexer` (`assembleOnboardingStatus`) already exposes
  `tmuxUsable`/`herdrUsable`; no contract change needed — the UI just stops offering unusable ones.

## Test plan

- Unit (web): with `herdrUsable: false`, the herdr option is not rendered; with only tmux usable,
  the step auto-selects and shows the confirmation (no chooser). With both usable (host-dev), both
  appear (no regression for non-container dev).

## Open questions for sign-off

1. Hard-remove herdr from the UI, or filter by `herdrUsable` (keeps it for a future host-dev setup
   that actually has herdr)? (Draft: **filter by usability** — data-driven, no regression for dev.)
2. Collapse the step entirely when only one multiplexer is usable, or keep it as a one-line
   informational confirmation? (Draft: keep a brief confirmation; collapsing risks hiding the
   "commands run in an inspectable session" trust message.)
