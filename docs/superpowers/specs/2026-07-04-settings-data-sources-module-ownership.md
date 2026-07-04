# Settings Data Sources and Module Ownership (#732)

**Status:** approved
**Issue:** #732
**Author:** Codex, grill-me with Ben - 2026-07-04

## 1. Problem

`/settings` > Data sources currently surfaces Email and Calendar future behaviors as generic
`Coming soon` rows. That makes Data sources feel like a roadmap bucket, while Ben expects it to be
the place for Notes/source indexing. Email and Calendar behavior belongs with those modules, and
briefing inclusion can also appear in Briefings because that is where users may look for it.

## 2. Decisions

- Data sources is Notes-only for this issue.
- Email and Calendar behavior controls live in their respective module settings.
- Briefing inclusion may be exposed in both places:
  - Briefings settings: include Email / include Calendar.
  - Email / Calendar settings: use this module in briefings.
- Mirrored controls read/write one backend setting per behavior. If the user changes it in one
  place, the other place reflects the same value.
- Do not show Email/Calendar rows or link cards in Data sources.
- "Coming soon" is acceptable only when the UI points to tracked work.

## 3. Scope

- Remove Email/Calendar source-behavior rows from the Data sources pane.
- Keep Notes source setup, notes sync status, and notes indexing controls in Data sources.
- Move/keep Email and Calendar behavior settings in their module settings surfaces.
- Add or preserve mirrored Briefings controls for source inclusion, backed by the same persisted
  behavior values.
- Make query invalidation/cache updates keep mirrored controls coherent.

## 4. Non-Goals

- Implement Calendar auto-write behavior; #736 owns that.
- Implement notification preferences; #735 owns that.
- Build new Email/Calendar provider setup flows.
- Remove all `Coming soon` UI globally.

## 5. Acceptance

- `/settings` > Data sources renders Notes-related controls only.
- Email and Calendar behavior controls are reachable from Email/Calendar module settings.
- Briefing source inclusion controls are reachable from Briefings settings and module settings.
- Changing a mirrored briefing inclusion setting in one place updates the other after normal cache
  refresh/invalidation.
- No Email/Calendar `Coming soon` backlog rows remain in Data sources.

## 6. Files In Play

- `~/Jarv1s/apps/web/src/settings/settings-personal-data-panes.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-data-source-model.ts`
- `~/Jarv1s/apps/web/src/settings/settings-module-subviews.tsx`
- `~/Jarv1s/packages/calendar/src/settings/index.tsx`
- `~/Jarv1s/packages/email/src/settings/index.tsx`
- `~/Jarv1s/packages/calendar/src/manifest.ts`
- `~/Jarv1s/packages/email/src/manifest.ts`

