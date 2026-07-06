# Briefings source labels (#739)

**Status:** Approved for build via RFA issue #739
**Date:** 2026-07-04
**Tier:** `routine`

## Problem

`/settings` > Modules > Briefings shows a Sources card that can expose raw assistant tool names such
as `calendar.listVisibleEvents` or `email.listVisibleMessages`. User-facing settings should not show
function-style internal identifiers.

## Scope

Choose the smaller correct fix:

- remove the Sources card if source selection is not user-actionable in this panel; or
- keep the card and render stable human labels such as Calendar, Email, Tasks, Notes, and
  Notifications.

Underlying `selectedToolNames` remain internal IDs for briefing creation. This is presentation only.

## Guardrails

- Do not change selected tool IDs or assistant tool registration.
- Do not add a new source-selection product surface.
- Do not touch Email module behavior without coordinator approval.

## Acceptance

- Briefings settings no longer displays raw assistant tool names.
- If the card remains, labels are human-readable and stable.
- Tests cover label mapping or card removal so raw tool IDs do not return to the UI.
