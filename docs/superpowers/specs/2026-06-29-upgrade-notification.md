# Upgrade Notification (#543)

**Status:** draft
**Date:** 2026-06-29
**Owner:** Dwight
**Grounded on:** 
- `~/Jarv1s/apps/api/src/server.ts:282` (`getHostDiagnostics` version exposure)
- `~/Jarv1s/apps/web/src/settings/settings-admin-panes.tsx:838` (Diagnostic version row)
- `~/Jarv1s/packages/shared/src/platform-api.ts:578` (`HostDiagnosticsInfo` interface)
- `~/Jarv1s/apps/web/src/today/briefing-freshness.tsx:60` (`BriefingStaleBanner` notification pattern)

## 1. Problem

When a new version of the Jarvis Docker image is published to `ghcr.io/motioneso/jarv1s`, users running self-hosted instances are unaware unless they manually check GitHub or their container registry. We need a way for the running instance to detect new versions, notify the user natively in the app, and surface the release/change notes so they understand what the update contains before pulling it.

## 2. Design

### Detection
The worker process will run a periodic job (e.g., daily and on startup) to check the GitHub Releases API (`https://api.github.com/repos/motioneso/Jarv1s/releases/latest`) for the latest stable release.
The job compares the remote `tag_name` against the currently running version exposed in `process.env.JARVIS_APP_VERSION`.
If `latest_version > current_version` (evaluated via semver), an update is flagged as available.
The latest version string and the release notes markdown (from the API response `body`) are cached persistently (e.g., in `app.system_state` or `app.preferences`).

### Sourcing Release Notes
The release notes are sourced directly from the GitHub Releases API `body` field. The instance caches this markdown string to avoid rate limits and ensures it is available for the frontend to render.

### Notification Surface
The backend API exposes the cached `latestAvailableVersion` and `releaseNotes` alongside existing diagnostics, either by extending `HostDiagnosticsInfo` or via a dedicated system status endpoint.
When the frontend detects a pending upgrade:
1. A dismissible global **Banner** (patterned after `BriefingStaleBanner`) is displayed at the top of the main layout (e.g., the Today page): _"A new version of Jarvis (vX.Y.Z) is available. [View changes] [Dismiss]"_
2. Clicking **[View changes]** opens a Modal rendering the cached markdown release notes.
3. The **Settings -> Diagnostics** pane (`settings-admin-panes.tsx`) is updated to show an "Update Available" badge on the Version row, with a button to view the release notes.

## 3. Slices

- **Slice 1: Detection & Sourcing.** Create a background job in `packages/jobs` to fetch the latest release from the GitHub API, compare it to `JARVIS_APP_VERSION`, and store the version and notes in the database.
- **Slice 2: API & Frontend Surface.** Extend `HostDiagnosticsInfo` to serve the update state. Build the `SystemUpgradeBanner` and the release notes Modal. Wire the Settings pane to reflect the update status.

## 4. DoD (Definition of Done)

- [ ] Background job reliably fetches the latest release from GitHub API.
- [ ] Proper semver comparison prevents downgrades or redundant notifications.
- [ ] API securely exposes the update availability and markdown release notes.
- [ ] UI displays a dismissible banner when an update is available.
- [ ] Modal correctly renders the release notes markdown.
- [ ] Settings > Diagnostics pane reflects the update state.

## 5. Out of scope

- **Automatic application of the upgrade.** Updating Docker images requires host-level container orchestration (e.g., `docker compose pull && docker compose up -d`), which is outside the container's control.
- **Push notifications/emails.** The in-app banner is sufficient for surfacing host-level maintenance information.
- **Pre-release/Beta channels.** Only the latest stable release is tracked.
