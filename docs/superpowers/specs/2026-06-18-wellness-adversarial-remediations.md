# Spec: Wellness Adversarial Remediations

**Status:** approved
**Date:** 2026-06-18
**Owner:** Ben
**GitHub:** Issue #307 (Wellness adversarial remediations)
**Target:** Wellness module (Phase 5)

This spec defines the remediations for the vulnerabilities and edge cases identified during the adversarial review of the Wellness module design.

## 1. Temporal Fixes for Daily Averages

- **Data Model Update:** Add `local_date` (text, e.g., `YYYY-MM-DD`) and `timezone_offset` (smallint, minutes) columns to `app.wellness_checkins`. This ensures that daily averages and streak calculations are stable across time zone changes.
- **Migration & Backfill:** Add a new migration in `packages/wellness/sql/` (numbered sequentially by global landing order) to alter the table. For existing rows, backfill `timezone_offset` with `0` (UTC) and compute `local_date` from `checked_in_at` at UTC. For new rows, the frontend must supply the client's current `timezone_offset` and `local_date`.

## 2. Architecture & Performance

- **Timeout on FocusSignalProvider:** Wrap the generic `FocusSignalProvider` execution in `Promise.race` with a strict timeout (e.g., 250ms) in the core focus computation. If a module's provider takes longer, it resolves as `null` (no signal), preventing the Tasks focus endpoint from hanging.

## 3. UX & State Consistency

- **Disabled Module Guard:** Implement a client-side `<DisabledModuleGuard module="wellness" />` component around the `<WellnessPage />` route in `apps/web/src/app.tsx`. This explicitly checks the module's active state using the existing `useModules()` hook (which consumes `GET /api/me/modules`) and renders a clean "Module Disabled" fallback instead of mounting the page and triggering 404ing API requests.

## 4. Privacy & Third-Party LLM Consent

- **Explicit Data Sharing Consent:** Before using the "Save & discuss" feature or adding the `wellness.recentCheckIns` tool to a briefing, require the user to acknowledge a one-time consent prompt.
- **Storage Semantics:** Store the consent as a boolean in `app.preferences` under the key `wellness.ai_consent_granted`. This is owner-scoped, read/written via the existing settings repository (`packages/structured-state`), defaults to `false`, and can be revoked by setting to `false`.
- **Server-Side Enforcement:** The AI/tool layer (`wellness.recentCheckIns` execution) MUST read this preference. If `false`, the tool throws or returns a graceful "Consent not granted" string, blocking the AI from accessing the health data regardless of the frontend state.

## Acceptance Criteria

1. A new migration in `packages/wellness/sql/` adds `local_date` and `timezone_offset` to `app.wellness_checkins` and backfills existing rows using UTC.
2. The core focus computation wraps `FocusSignalProvider` calls in a 250ms `Promise.race`, defaulting to `null` on timeout.
3. The `<DisabledModuleGuard />` is implemented and wraps `<WellnessPage />`, using the existing module-state hook to prevent API 404 errors when the wellness module is disabled.
4. The frontend verifies `wellness.ai_consent_granted` exists in `app.preferences` before executing "Save & discuss" and prompts the user if missing.
5. The backend `wellness.recentCheckIns` tool explicitly checks `wellness.ai_consent_granted` via the settings repository and blocks data access if not granted.
