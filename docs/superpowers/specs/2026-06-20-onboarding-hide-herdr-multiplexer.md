# Spec — onboarding control-channel: hide the unavailable herdr option (#366)

**Status:** APPROVED 2026-06-20 (Ben — keep it minimal: disable herdr in onboarding + force tmux;
defer the broader multiplexer-step rework).
**Tracks:** #366. Part of #342. Same onboarding surface as #365/#369 (collision — sequence on the
wizard files).

## Problem

The "01 Control channel" step (`apps/web/src/onboarding/multiplexer-step.tsx`, OPTIONS line ~25)
offers **herdr** as a multiplexer choice even though it's "Not installed" and **not a real option**
in the deployed container — the cli-runner sidecar always uses bundled **tmux**. Presenting an
unselectable/irrelevant option is confusing and makes the step look like it needs a decision it
doesn't.

## Decisions (locked 2026-06-20)

1. **Disable herdr in onboarding + force tmux** (Ben — keep it minimal for now). Don't offer herdr at
   all in the onboarding multiplexer step; the container always uses bundled tmux.
2. **Defer the broader rework.** A fuller multiplexer-step redesign (usability-driven options,
   collapsing the step, host-dev parity) is a later pass — not this issue. Keep the change small and
   contained to the onboarding step.

## Design

- In `multiplexer-step.tsx`: **remove herdr from the OPTIONS** shown in onboarding (the herdr entry
  at OPTIONS line ~25). Leave tmux/Auto. Do NOT touch the broader multiplexer settings elsewhere.
- Keep the existing `setChatMultiplexerSettings` call (PUT `/api/admin/chat-multiplexer`) for the
  selected value (Auto/tmux). No backend contract change.
- Out of scope (deferred): auto-selecting/collapsing the step, usability-filtering, host-dev herdr
  parity. Just hide herdr in onboarding now; revisit the step's UX later.

## Test plan

- Unit (web): the herdr option is **not rendered** in the onboarding multiplexer step; tmux/Auto
  still render and select normally; no change to the broader multiplexer settings.

## Resolved (2026-06-20)

- Hard-remove vs filter → **just remove herdr from the onboarding step** (minimal; Ben). The broader
  usability-driven redesign + step collapsing are explicitly **deferred** to a later pass.
