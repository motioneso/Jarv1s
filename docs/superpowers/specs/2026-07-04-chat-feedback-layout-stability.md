# Chat feedback layout stability (#747)

**Status:** Proposed - needs Ben approval before build
**Date:** 2026-07-04
**Tier:** `routine`

## Problem

When assistant feedback/status controls such as `Saved` and `Undo` appear, the response text column
gets pushed narrower. Long answers wrap into a smaller column once those controls appear beside the
response header/actions.

## Scope

- Keep the assistant response body at a stable readable width before and after feedback state changes.
- Move or constrain feedback/status controls so they do not reflow or squeeze the message body.
- Preserve accessible controls on mobile-width chat panes.

## Guardrails

- Do not change feedback persistence semantics.
- Do not add new feedback states.
- Do not overlap controls with message content.

## Acceptance

- Showing `Saved` and `Undo` does not reduce the body text column width.
- Controls remain accessible and do not overlap content on mobile-width chat panes.
- Long responses preserve normal readable wrapping before and after feedback state changes.

