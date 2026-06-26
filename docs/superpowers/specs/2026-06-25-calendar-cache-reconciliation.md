# Calendar cache: stale-event reconciliation + user-visible refresh (#473)

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s/packages/connectors/src/sync-jobs.ts` (sync upserts only, no delete),
`packages/connectors/src/google-api-client.ts:81` (`listCalendarEvents` — `singleEvents=true`, no
`showDeleted`), `packages/connectors/src/routes.ts:130` (`POST /api/connectors/google/sync` exists,
per-actor singleton), `packages/calendar/src/repository.ts` (`upsertCachedEvent` only, no delete),
`packages/calendar/sql/0011_calendar_module.sql` (`UNIQUE(connector_account_id, external_id)`,
prevent-identity-change trigger blocks UPDATE of identity cols, not DELETE),
`apps/web/src/settings/settings-personal-data-panes.tsx` (`ConnectedPane`/`AccountRow` — Reconnect/Revoke
only, no Sync now for users).

## 1. Decision

Two coupled problems, one fix:

1. **Stale cache root cause:** the google-sync job only upserts; it never removes calendar events
   that Google deleted or cancelled. So stale rows persist forever in `app.calendar_events`.
2. **No user recovery path:** the existing `POST /api/connectors/google/sync` endpoint exists but is
   only surfaced as "Sync now" in the **admin** pane. A regular user has no way to force a refresh.

**Fix:** make the sync job self-correcting (reconcile — delete stale/cancelled after the upsert
loop), and surface the existing sync endpoint as a user-visible "Sync now" button on each connected
account row. The refresh button then genuinely recovers the cache.

## 2. Reconciliation in the sync job

In `packages/connectors/src/sync-jobs.ts`, after the calendar upsert loop completes for an account:

1. Collect the set of fresh `externalId`s actually upserted in this run (excluding cancelled — see
   below), plus any skipped for unusable times (those are still "present" in Google, just skipped
   locally — keep them).
2. Call a new `CalendarRepository.deleteStaleCachedEvents(scopedDb, { connectorAccountId,
   keepExternalIds })` that deletes rows where `connector_account_id = $1 AND external_id <> ALL($2)`.
   RLS scopes by owner; the worker runtime already has DELETE... **check:** the current grants give
   the worker SELECT/INSERT/UPDATE on `calendar_events` — a new migration must add DELETE. See §5.
3. **Cancelled handling:** when the fresh Google event has `status === "cancelled"`, do NOT upsert
   it back. Instead include its `externalId` in the `deleteStaleCachedEvents` keep-set is WRONG —
   rather: skip upserting cancelled events, AND treat them as absent (so any existing cached row for
   that external_id is deleted as stale). Concretely: build `keepExternalIds` from non-cancelled
   fresh events only; cancelled events' existing cached rows (if any) get deleted by the same
   stale-DELETE because their ids aren't in the keep-set.

This means a single reconciliation DELETE handles both fully-deleted events (absent from Google's
list) and cancelled instances (present with `status: "cancelled"`) — no separate code path.

### Window safety

The stale-DELETE is scoped to `connector_account_id` only, NOT to the time window. Rationale: a
deleted event outside the current sync window would never be in the fresh set and would
legitimately be removed — but it's also outside what the calendar view shows, so deleting it is
harmless and keeps the cache honest. Deleting the whole account's stale rows on each sync is cheap
(the table is per-user, small) and avoids window-edge bugs where an event just outside the window
survives a delete it shouldn't.

If this proves too aggressive in practice, narrow to `WHERE connector_account_id = $1 AND
starts_at BETWEEN syncWindowStart AND syncWindowEnd AND external_id <> ALL($2)`. **Decision: start
unscoped-by-window** (simplest correct behavior); revisit if it deletes something it shouldn't.

## 3. Calendar repository method

New in `packages/calendar/src/repository.ts`:

```ts
async deleteStaleCachedEvents(
  scopedDb: DataContextDb,
  input: { readonly connectorAccountId: string; readonly keepExternalIds: readonly string[] }
): Promise<number> {
  assertDataContextDb(scopedDb);
  const result = await scopedDb.db
    .deleteFrom("app.calendar_events")
    .where("connector_account_id", "=", input.connectorAccountId)
    .whereIf(
      input.keepExternalIds.length > 0,
      (eb) => eb.and(input.keepExternalIds.map((id) => eb.fn("NOT", eb("external_id", "=", id))))
    )
    // keepExternalIds empty → delete all rows for this account (sync found nothing)
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}
```

(Exact Kysely `<> ALL` construction to be validated in implementation — the intent is
`external_id NOT IN (keepSet)`; an empty keepSet deletes everything for the account, which is the
correct behavior when Google returned zero events.)

Add the deleted count to the sync result counts as `calendarReconciled` for observability.

## 4. User-visible "Sync now" button

In `apps/web/src/settings/settings-personal-data-panes.tsx`, `ConnectedPane` / `AccountRow`:

- Add a "Sync now" button to `AccountRow`, shown when the account's provider supports sync. Today
  that's Google only — gate on `account.providerType === "google"` (or a `capabilities.sync` flag
  on the account DTO if cleaner).
- The button calls the existing `syncGoogleConnector(account.id)` client fn
  (`apps/web/src/api/client.ts:867`, already used by the admin pane) → `POST /api/connectors/google/sync`.
- Disabled while a sync is in-flight for that account (the endpoint's per-actor singleton already
  dedupes server-side; mirror the pending state in the button).
- Self-correcting poll: after a successful enqueue, poll `listConnectorAccounts` (the query backing
  the pane) every ~2s for a bounded 30s window so the row's `lastSyncAt`/health updates without a
  remount. Reuse the exact pattern from the notes "Sync now" (`recentlySynced` + `syncTick` state,
  30s auto-clear). Extract a small `useConnectorSyncPoll` hook if it dedupes cleanly with the notes
  one — otherwise inline.
- Toast on success: "Sync started" (matches existing copy); on error: `readError`.

This makes the existing endpoint user-reachable. No new endpoint required.

## 5. Migration — worker DELETE grant

The worker runtime (`jarvis_worker_runtime`) currently has SELECT/INSERT/UPDATE on
`app.calendar_events` (migration `0066`). The reconciliation DELETE runs in the sync job (worker
context), so it needs DELETE too.

New migration `packages/calendar/sql/00NN_calendar_worker_delete_grant.sql` (next free global
number, ≥ current max):

```sql
-- #473: calendar cache reconciliation runs in the google-sync worker, which needs
-- DELETE to remove stale/cancelled cached events after each sync window. Owner-scoped
-- RLS still applies; no policy change (the existing owner-or-share select policy covers
-- the worker's owner-scoped context).
GRANT DELETE ON app.calendar_events TO jarvis_worker_runtime;
```

No RLS policy change — DELETE is governed by the existing owner-scoped policies (the worker runs
under an owner-scoped `DataContextDb`, same as today's upserts). Confirm in implementation that no
separate `calendar_events_delete` policy is required; if the existing owner-scoped policies are
SELECT/INSERT/UPDATE-only, add a matching owner-scoped DELETE policy.

## 6. Security & invariants

- **Owner-scoped only.** The DELETE runs in a per-actor `DataContextDb`; RLS ensures a sync for
  user A can never delete user B's events. No admin bypass (CLAUDE.md invariant).
- **No new secrets surface.** The reconciliation uses the same token holder / Google client the
  upsert path already uses. No new credentials.
- **Metadata-only job payload.** The sync job payload stays `{ actorUserId, kind,
  idempotencyKey }` — the reconciliation is computed from the fetched event set, not passed in the
  payload (CLAUDE.md invariant).
- **Bounded logging.** Log `calendarReconciled` count only — never external ids or event content.

## 7. Acceptance criteria (from #473)

- [ ] User-visible "Sync now" available on connected Google account rows in user-facing Settings
      (not admin-only).
- [ ] After a sync, stale deleted/cancelled provider events stop appearing in Jarv1s.
- [ ] Cancelled-status events (`status: "cancelled"`) are removed, not re-upserted.
- [ ] The reconciliation is automatic on every sync — no separate manual purge required to recover.
- [ ] Worker gains DELETE grant via migration; owner-scoped RLS intact.
- [ ] No new secrets, no admin bypass, metadata-only job payloads.

## 8. Out of scope (deferred)

- **Debug purge-by-external-id admin action** (mentioned in the issue). Reconciliation makes this
  unnecessary for recovery; revisit only if a specific row needs surgical removal that sync can't
  handle (e.g. a corrupt cached row).
- **Email stale reconciliation.** Email uses historyId skip-unchanged and has no equivalent stale
  bug reported; leave as-is.
- **Webhook/incremental sync.** Full reconciliation-on-poll is sufficient for the dogfood scale;
  Google push notifications are a later scale optimization.
- **A standalone "Purge cache" button.** Sync-with-reconciliation subsumes it.
- **Calendar-only sync mode.** The combined google-sync is fine; email re-sync cost is acceptable.
