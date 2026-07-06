# Recurring Google Calendar sync (#792)

**Status:** Approved
**Date:** 2026-07-05
**Tier:** `routine`
**Builds on:** #473 / PR #494 (reconciliation logic, shipped, manual-trigger only)

## Problem

Deleting an event in Google Calendar does not clear the cached copy in Jarvis. The reconciliation
logic that would do this is correct and already shipped, but nothing triggers it on a schedule —
only OAuth-connect and a manual "Sync now" click enqueue `GOOGLE_SYNC_QUEUE`.

## Scope

- Register a recurring schedule that enqueues `GOOGLE_SYNC_QUEUE` per connected calendar account,
  mirroring the existing `PROACTIVE_SCAN_SOURCE_QUEUE` ~30-min recurring pattern in
  `packages/module-registry/src/index.ts`.
- No change to `packages/connectors/src/sync-jobs.ts` reconciliation or
  `packages/calendar/src/repository.ts` `deleteStaleCachedEvents` — both already correct.
- No change to the manual "Sync now" route or the OAuth-connect-complete trigger — both keep
  working as-is; this only adds a third, automatic trigger.

## Guardrails

- Metadata-only job payload (connector account ID), consistent with existing sync jobs — no
  private event content in the pg-boss payload.
- Schedule interval should not be tighter than existing connector-sync rate-limit assumptions —
  match `PROACTIVE_SCAN_SOURCE_QUEUE`'s cadence unless there's a documented reason to differ.
- Do not touch the separate MCP-tool-vs-web-UI feature-grant filter inconsistency
  (`calendarListVisibleEventsExecute` grant filter vs. the ungated REST route) — out of scope,
  tracked as a possible follow-up, not this issue.
- Do not build two-way sync or a standalone Jarvis-native calendar entity — "local calendar"
  remains a read-only cache mirror of Google, as already designed.

## Acceptance

- An event deleted on the Google side disappears from Jarvis's cached copy (web calendar page
  and chat) within one scheduled sync interval, without any manual action.
- Existing OAuth-connect and manual "Sync now" triggers are unaffected.
- No regression to #473/#494's reconciliation correctness (still excludes `status==="cancelled"`
  events from the keep-set).
