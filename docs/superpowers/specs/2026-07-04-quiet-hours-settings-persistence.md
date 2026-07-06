# Quiet-hours settings persistence (#733)

**Status:** Approved for build via RFA issue #733 and #250 spec
**Date:** 2026-07-04
**Tier:** `sensitive`
**Builds on:** `docs/superpowers/specs/2026-06-22-quiet-hours-notification-deferral.md`

## Problem

`/settings` still renders quiet-hours controls as local, non-persistent UI. The page says saving
quiet hours is coming soon, the switch is hardcoded on, and the time inputs use default values.

#250 already specified current-user quiet-hours GET/PUT settings, Settings > General wiring, and
removal of hardcoded coming-soon quiet-hours UI.

## Scope

- Load quiet-hours controls from the current-user backend setting.
- Save switch and time changes through the existing quiet-hours API or the smallest route needed by
  the #250 contract.
- Remove the coming-soon note and `BACKEND-TODO` text.
- Preserve non-urgent notification deferral semantics from #250.

## Guardrails

- Owner-scoped settings only.
- Preserve overnight windows such as `22:00` to `07:00`.
- Do not add external notification channels or per-module urgency configuration.

## Acceptance

- Quiet-hours controls persist across reload.
- Switch and time inputs reflect backend state.
- Coming-soon quiet-hours copy is gone.
- Existing quiet-hours deferral behavior remains consistent with #250.
