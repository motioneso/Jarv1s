# #1192 Scout Report — Sync caps cause/scope/freshness/recovery

**Coordinator:** session 019f7c2e-9662-7fd0-ab3e-694241b334ae (pane w1:pTK)
**Scout pane:** w1:pWV (read-only; no edits/commits/issues/annotations touched)
**Branch inspected:** `coord/1179-pdf` @ `a753027a` (clean except unrelated `docs/coordination/2026-07-19-1179-pdf-bundle.md`)
**Parent issue:** #995 (CLOSED 2026-07-15). #1192 is the deferred capability-freshness slice.

## Verdict

**Buildable, medium size, low secrecy risk.** #995's security design
(`docs/superpowers/specs/2026-07-13-995-connected-account-health-provider-setup-security-design.md`)
already specced exactly what #1192 asks for, but that slice did NOT land — only the picker/IMAP
reconnect slice shipped in `2f4f553d` (#1063). The missing capability/origin/freshness/recovery
metadata + the owner retry route are unclaimed and ready to build verbatim from the existing
spec. No new security decisions needed; this is execution of an approved design.

## What is broken / missing today

`getConnectorAccountHealth()` at `apps/web/src/settings/settings-connector-sync.ts:78-91` collapses
every truncated/partial run to one string ("Message cap reached" / "Partial sync") with a single
hardcoded "Cached Google data may be stale" freshness line. It cannot report:

1. **Capability** — which of email/calendar was capped/failed (no per-capability outcome field).
2. **Origin/cause** — whether the cap is the Jarv1s deployment limit
   (`JARVIS_EMAIL_SYNC_CAP`, `DEFAULT_EMAIL_MESSAGE_CAP = 50`, `sync-jobs.ts:65`), an upstream
   auth failure (`auth-error`), or an upstream provider/item failure
   (`email-error`/`email-message-error`/`calendar-error`/`calendar-item-error`). Today the
   truncated branch always says "message cap reached" regardless of why.
3. **Freshness** — no per-capability last-success timestamp. `lastSyncFinishedAt` is the *run*
   end, not the last *successful* capability sync; failure destroys the prior signal.
4. **Recovery** — `canReconnect: false` for the capped state and there is **no
   `POST /api/connectors/accounts/:id/sync` retry route** anywhere (only `POST /api/connectors/google/sync`
   exists, hardcoded to Google). User has no in-product recovery for a deployment cap.

## Minimal spec delta (per #1192 acceptance, pre-approved design)

### A. Migration — bounded per-capability metadata (new)

File: `packages/connectors/sql/0165_connector_capability_freshness.sql` (number reserved by spec).

```sql
ALTER TABLE app.connector_accounts
  ADD COLUMN IF NOT EXISTS last_email_sync_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_calendar_sync_success_at timestamptz;

GRANT UPDATE (last_email_sync_success_at, last_calendar_sync_success_at, updated_at)
  ON app.connector_accounts TO jarvis_worker_runtime;
```

`last_sync_counts` jsonb is extended **in place** (no schema change — already `jsonb_typeof = 'object'`)
with bounded keys:

- `emailOutcome`: `not-run | success | partial | failed`
- `calendarOutcome`: `not-run | success | partial | failed`
- `emailError`: `null | auth-error | email-error | email-message-error`
- `calendarError`: `null | auth-error | calendar-error | calendar-item-error`
- `emailFailures`, `calendarFailures`: non-negative ints (>=1 on section-level failure even if loop never started)
- existing `truncated` flag is retained (email-only).

### B. DTO + types

`packages/shared/src/connectors-api.ts:12-19` `ConnectorSyncCounts` — add the optional fields above.
`ConnectorAccountDto` (`:31-49`) — add `lastEmailSyncSuccessAt`, `lastCalendarSyncSuccessAt` (nullable
ISO strings).

`packages/db/src/types.ts` — add the two columns to the `ConnectorAccount` row type.

`packages/connectors/src/repository.ts:45, 262, 572` — persist + select the new columns.

### C. Worker writes (independent per-capability outcomes)

`packages/connectors/src/sync-jobs.ts:runGoogleSync` (line 257) — on each granted capability
section completion: advance that capability's `last_*_sync_success_at` only on clean success;
persist `emailOutcome`/`calendarOutcome`/error/failure counts **independently** (never infer from
`errors[0]` — see `:507-512`, currently takes `errors[0]` only and can discard a second
capability's failure). Token-acquisition failure (`:300-316`) marks both scoped+granted capabilities
`failed`/`auth-error`. Truncation marks email `partial`, retains `truncated`.

`packages/connectors/src/imap-sync-jobs.ts:runImapSync` (line 61) — IMAP only owns email; writes
email outcome + timestamp, calendar stays `not-run`.

### D. Owner-scoped retry route (new)

`packages/connectors/src/routes.ts` — add `POST /api/connectors/accounts/:id/sync`:
- one `withDataContext`; resolve authenticated actor; find actor-visible active account;
- select queue by stored `providerType` (google|imap); accept **no** provider/actor/queue/credential/command param;
- Google payload = actor metadata only; IMAP payload = actor id + account id + kind + idempotency key;
- `pg-boss.send()` null ⇒ `{ deduped: true }`;
- revoked/missing/other-owner ⇒ same not-found;
- rate-limit by authenticated principal.

Replace nothing; add no content-bearing job.

### E. UI mapper rewrite (pure)

`apps/web/src/settings/settings-connector-sync.ts:getConnectorAccountHealth` — map bounded metadata
to: capability (Email/Calendar/both) · origin (Jarv1s deployment / upstream auth / upstream
provider / unknown) · last-success freshness with stale wording · one next action (Retry via the
new route, Reconnect via existing Google/IMAP connect, or wait/configure). Existing
`syncAlert`/`syncErrorLabel`/`syncCountsLabel` helpers (`:118-158`) extend, not duplicate.

### F. Oversight surface

`apps/web/src/settings/settings-admin-panes.tsx:OversightPane` (`:553`) already calls
`getConnectorAccountHealth` + reads `lastSyncFinishedAt`/`lastSyncError`. The rewrite propagates
automatically; just add the capability/origin/freshness copy under the existing Badge
(`:583-596`). Admin stays **metadata-only** — no retry/reconnect route is exposed here.

## Exact files / contracts (collision surface)

| File | Change | Collision risk |
| --- | --- | --- |
| `packages/connectors/sql/0165_connector_capability_freshness.sql` | new | **migration number** — verify no other lane grabbed `0165` at build time (spec reserves it) |
| `packages/connectors/sql/0100_connector_admin_safe_metadata_health.sql` | extend RETURNS TABLE with 2 cols + DROP/recreate fn | low — function already DROP/RECREATE pattern |
| `packages/shared/src/connectors-api.ts` | extend 2 interfaces | low — additive optional fields |
| `packages/db/src/types.ts` | additive | low |
| `packages/connectors/src/repository.ts:45,262,572` | extend writes/reads | low |
| `packages/connectors/src/sync-jobs.ts` (`runGoogleSync`, `markSyncFinished`) | per-capability outcomes + timestamps | **medium** — hot file, also owned by #1179 PDF worker lane in this same worktree |
| `packages/connectors/src/imap-sync-jobs.ts` | per-capability outcomes (email only) | low |
| `packages/connectors/src/routes.ts` | new `POST /api/connectors/accounts/:id/sync` route + schema | low — appends |
| `apps/web/src/settings/settings-connector-sync.ts` | rewrite `getConnectorAccountHealth` | **medium** — shared with any other connector-health lane |
| `apps/web/src/settings/settings-admin-panes.tsx:553-614` | OversightPane freshness copy | low |
| `apps/web/src/api/connectors-client.ts` | add `retryConnectorAccountSync(id)` | low |
| `apps/web/src/settings/settings-personal-data-panes.tsx` | wire Retry button when `health.canRetry` | **high collision** — listed in spec as "#987-gated"; verify on rebased head |

## Security / RLS posture (unchanged from #995 design)

- Owner isolation unchanged: `0022_connectors_owner_only.sql` enforces `owner_user_id =
  current_actor_user_id()` on every connector_accounts write. Retry route must use
  `withDataContext` + actor-visible lookup; missing vs. unauthorized ⇒ indistinguishable
  not-found.
- Admin path stays aggregate-only: `0100_connector_admin_safe_metadata_health.sql` fn is
  `SECURITY DEFINER`, gated on `is_instance_admin`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO
  jarvis_app_runtime`. New columns flow through unchanged. **Never add an admin retry route.**
- Worker grant: `0099_connector_health_metadata.sql:16-23` already grants UPDATE on the health
  columns to `jarvis_worker_runtime`. New timestamp columns need the same grant (in `0165`).
- Secret redaction: worker persists **bounded labels only** — never raw provider error, token,
  refresh_secret, message body, subject, external id. Existing pattern at `sync-jobs.ts:296-298,
  466-475` (warns `{name, statusCode}` only). New fields inherit the same boundary.
- Existing `resolveEmailMessageCap` (`sync-jobs.ts:73-78`) already guards NaN/<=0/non-int — no
  regression risk if anyone touches the cap env var.
- Per-item health table is a **non-goal**; raw error text is a **non-goal**.

## Tests / live proof required by #1192 acceptance

Existing harness to extend: `tests/unit/settings-connector-sync.test.tsx` (already covers the
`Partial`/`Message cap reached`/auth-failure cases at `:46-81`). Add one case per health state
asserting: capability named, origin named, freshness present (or honestly absent), one next
action, no secret material, `canRetry` correct per provider (Google + IMAP).

Required new tests:
1. `sync-jobs` integration: both-fail run preserves both bounded outcomes + nonzero counts
   (regresses the `errors[0]` discard at `:512`).
2. `sync-jobs` integration: truncation ⇒ email `partial`, timestamp not advanced, calendar
   unaffected.
3. `sync-jobs` integration: token-acquisition failure ⇒ both scoped+granted `failed`/`auth-error`.
4. Retry route integration: owner succeeds/dedupes truthfully; other-owner/revoked/unauthenticated/
   unsupported all return same not-found; rate-limit by principal.
5. Secret-scan test: responses/logs/audit/jobs contain no connector secret across all new paths.
6. Migration round-trip: timestamps default null; columns readable by owner + admin; worker grant
   present.

Live proof (spec `Verification and Live-path Proof`): on deployed 5178 instance, connect one IMAP
provider, exercise bounded failed + successful retry, verify freshness/action copy, toggle Email
access off/on, prove live/cached behavior changes. **No deep-linking, no `tests/uat/**` edits.**

Gate: `pnpm verify:foundation`, design-token checks, focused tests, adversarial security QA,
live-path proof.

## Collision notes for the Coordinator

- This worktree (`coord/1179-pdf`) is also running the #1179 PDF worker-bundle lane, which edits
  `packages/connectors/src/sync-jobs.ts`. If #1192 spawns here, gate the build agent on the
  **rebased head after #1179 merges** and explicitly coordinate the shared file (spec's #987
  precedent — re-read merged file, plan collision once).
- `0165` migration number must be re-resolved at build time (spec's own reservation warning).
- `settings-personal-data-panes.tsx` is the highest-collision UI file; spec already mandates the
  #987-style rebase gate.
- No other in-flight scout/build lane owns the freshness metadata or the retry route (verified:
  no `POST /api/connectors/accounts/:id/sync`, no `last_*_sync_success_at` columns, no
  per-capability outcome fields exist anywhere in tree).

## Reconciliation with #1192 acceptance

| #1192 acceptance | How satisfied |
| --- | --- |
| Connected + Oversight identify affected capability | per-capability `emailOutcome`/`calendarOutcome` flow into the shared mapper both panes already call |
| Copy explains stale data + recovery/next run | mapper rewrite names freshness (last-success timestamp) + one of {Retry, Reconnect, wait/configure} |
| Freshness only from trusted bounded metadata | only `last_*_sync_success_at` + bounded counts; never inferred from `lastSyncFinishedAt` |
| Raw errors/creds/content never reach oversight | existing bounded-label boundary preserved; admin path aggregate-only |
| Focused tests + live 5178 proof cover capped state | test list above + spec's live-path proof |

All four #1192 acceptance items map to the pre-approved #995 design. No new decision points.
