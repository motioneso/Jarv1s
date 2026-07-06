# Module Notification Preferences (#735)

**Status:** approved
**Issue:** #735
**Author:** Codex, grill-me with Ben - 2026-07-04

## 1. Problem

The Notifications settings panel is local-only sample UI. It exposes channels and hardcoded
categories that do not map to real backend behavior. Ben wants no working-looking controls that do
nothing, but `Coming soon` rows are fine when they point at concrete tracked work.

## 2. Decisions

- V1 delivery is in-app notifications only.
- Push and Email digest stay visible only as `Coming soon` / unavailable rows tied to:
  - #743 Web Push notification delivery.
  - #742 notification email digest delivery.
- Notification preferences are module-based, not hardcoded categories.
- A module appears in the global Notifications panel only if:
  - it is enabled for the current user, and
  - its manifest declares notification support.
- The global panel knows only module id/name and an on/off preference.
- Detailed notification controls live inside each module's own settings surface.
- Every new notification must carry a `moduleId`.
- If a module notification toggle is off, no new notifications for that module are created.
  There is no urgent/system bypass in Notifications; urgent context can surface elsewhere, such as
  briefings.
- When a user turns a module off, Jarv1s asks whether to clear pending unread notifications for
  that module. If yes, mark them read; do not delete them.

## 3. Scope

- Replace `DEFAULT_NOTIFICATIONS`-backed local state with persisted per-user preferences.
- Add/reuse a manifest declaration for notification-capable modules.
- Add a generic per-module notification preference API.
- Require `moduleId` at the notification creation boundary.
- Gate notification creation on the per-module preference.
- Render one global on/off row per enabled, notification-capable module.
- Link each module row to that module's settings when a settings surface exists.
- Render Push and Email digest as unavailable/tracked rows, not toggles.

## 4. Non-Goals

- Web Push delivery (#743).
- Email digest delivery (#742).
- Module-specific subtype controls in the global Notifications panel.
- Deleting existing notifications.

## 5. Acceptance

- Notification settings survive reload.
- Enabled modules that declare notification support appear in Notifications settings.
- Disabled/uninstalled modules do not appear.
- Turning a module off prevents new notifications for that module.
- Turning a module off can optionally mark existing unread notifications from that module read.
- Notifications created without a valid `moduleId` are rejected or fail tests at the repository/API
  boundary.
- Push and Email digest do not look enabled unless implemented.

## 6. Files In Play

- `~/Jarv1s/apps/web/src/settings/settings-module-subviews.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-personal-data-panes.tsx`
- `~/Jarv1s/packages/notifications/src/repository.ts`
- `~/Jarv1s/packages/notifications/src/routes.ts`
- `~/Jarv1s/packages/notifications/src/manifest.ts`
- `~/Jarv1s/packages/shared/*notifications*`
- module manifests that opt into notifications
