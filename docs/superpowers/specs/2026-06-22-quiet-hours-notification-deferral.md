# Quiet Hours: Persist Settings and Defer Non-Urgent Notifications

**Issue:** #250
**Status:** Approved for build
**Date:** 2026-06-22
**Milestone:** Next Roadmap · Post-first-week success

## Problem

Quiet-hours configuration has no persistence — settings reset on reload. Non-urgent in-app
notifications fire regardless of time, disturbing the user during sleep or focus windows.

## Scope (this issue)

- Per-user quiet-hours GET/PUT settings (start time, end time, timezone, enabled flag).
- Validate `HH:mm` format; support overnight windows (e.g. 22:00–07:00).
- Use the user's locale timezone from preferences unless the quiet-hours setting carries an
  explicit timezone override.
- Extend notification creation with a bounded `urgency` field (`urgent` | `normal` | `low`).
- During active quiet hours, defer `normal` and `low` urgency notifications rather than dropping
  them; `urgent` notifications fire immediately regardless.
- Deferred notifications are released at quiet-hours end (next delivery tick or on-wakeup query).

## Out of scope

- Calendar focus-block scheduling.
- External notification channels (push, email).
- Per-module urgency configuration (use hardcoded defaults per notification type for now).

## Data

Migration **0098** (reserve 0098–0099):

```sql
-- user_quiet_hours settings row (or column on user_preferences if it exists)
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS
  quiet_hours jsonb NOT NULL DEFAULT '{"enabled":false,"start":"22:00","end":"07:00","timezone":null}';
```

If `user_preferences` does not exist, create a minimal `user_quiet_hours` table with
`(user_id PK FK, settings jsonb, updated_at)` + RLS owner-only.

## API

```
GET  /api/settings/quiet-hours          → { enabled, start, end, timezone }
PUT  /api/settings/quiet-hours          → body { enabled, start, end, timezone }
```

Notifications module: add `urgency: 'urgent' | 'normal' | 'low'` to `CreateNotificationDto`
(default `normal`). Notification creation checks quiet-hours if `urgency !== 'urgent'`.

## Acceptance

- GET/PUT round-trips persist across reloads.
- Overnight windows (22:00–07:00) resolve correctly for a user in any timezone.
- `urgent` notifications always fire; `normal`/`low` are deferred during quiet hours.
- `pnpm verify:foundation` passes.
