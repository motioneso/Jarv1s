# Connector Health Monitoring

**Status:** Approved
**Date:** 2026-06-18
**Owner:** Ben
**GitHub:** #254

## Goal

Make Settings -> Admin -> Connector oversight show useful connection health for every connected
account without exposing synced data or secrets.

## Current State

The admin view is real but shallow:

- `GET /api/admin/connectors/accounts` returns safe connector-account metadata through
  `app.list_connector_account_safe_metadata()`.
- The UI shows a health badge derived only from `account.status`.
- Sync jobs log bounded error labels and return counts, but the account row does not retain
  last-sync time, last success/failure, or a safe error reason.

Admins can see that an account is `active`, `error`, or `revoked`, but not whether it synced
recently or what kind of bounded failure needs attention.

## Scope

Add durable, safe health metadata to connector accounts:

- `last_sync_started_at`
- `last_sync_finished_at`
- `last_sync_status`: `success | partial | failed | null`
- `last_sync_error`: bounded string label or null
- `last_sync_counts`: small JSON object with aggregate counts only

Update Google sync to write those fields:

- On start: set `last_sync_started_at`, clear stale in-flight-only UI state if needed.
- On success with no bounded errors: `success`.
- On success with bounded item errors: `partial`.
- On thrown top-level sync failure: `failed` and a bounded error label.

Extend safe admin and owner DTOs to include the same health fields. They must stay aggregate-only:
no email subjects, calendar titles, external IDs, provider response bodies, tokens, or raw errors.

## UI

In Settings -> Admin -> Connector oversight:

- Show provider name/type as today.
- Show health:
  - `Healthy` for recent success;
  - `Partial` for bounded item errors;
  - `Needs attention` for failed/error;
  - `Revoked` for revoked.
- Show last finished time when present.
- Show the bounded error label only for partial/failed states.

Keep the page read-only. Recovery actions can stay in the owner connector UI or a later admin action
spec.

## Guardrails

- Do not store raw provider errors. Map them to bounded labels such as `auth-error`,
  `calendar-error`, `email-error`, `calendar-item-error`, or `email-message-error`.
- Do not store per-item details in `last_sync_counts`.
- Admin route remains admin-only and safe metadata only.
- Owner route may expose the same health for the owner's own accounts.
- Revoked accounts stay revoked; sync must not silently un-revoke.

## Out Of Scope

- Alerting/notifications.
- Admin-triggered reconnect or revoke actions.
- Per-calendar/per-label drilldown.
- New provider types beyond the current Google sync path.

## Verification

- Migration test or integration assertion that new columns exist and default to null.
- Integration: successful sync updates `last_sync_*` with aggregate counts.
- Integration: partial sync records `partial` plus bounded labels, not raw errors.
- Integration: top-level failure records `failed` without leaking provider response bodies.
- Integration: non-admin cannot list admin connector health.
- UI/manual: admin sees last sync status/time/error label for connected accounts.

## Acceptance Criteria

- Admin connector oversight is based on durable sync health, not just `status`.
- Health metadata is safe to expose to admins and owners.
- Sync failures become visible without leaking secrets or synced content.
- `pnpm verify:foundation` passes.
