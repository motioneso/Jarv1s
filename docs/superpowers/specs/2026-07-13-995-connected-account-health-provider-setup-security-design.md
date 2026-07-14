# Connected-account Health and Provider Setup — Security Design (#995)

**Status:** Proposed — approval-ready; build blocked behind #987 and this approval

**Date:** 2026-07-13

**Issue:** #995

**Security tier:** Security

**Grounded on:** `676e99cd` after `pnpm audit:preflight` confirmed zero commits behind
`origin/main` (`96d22ba0`)

## Build-order Gate

Do not begin #995 implementation until #987 is merged into the target branch and the #995 branch is
rebased on that result. Both issues legitimately own
`apps/web/src/settings/settings-personal-data-panes.tsx`; #987 goes first and #995 plans the collision
once, after re-reading the merged file. #993 does not claim that file.

#1042 is a separate module-distribution lane. This spec and plan do not include
`apps/web/src/settings/settings-module-registry-section.tsx`. If implementation later proves that
file necessary, stop and notify the UX Coordinator before proceeding.

## Context

Connector health and grants are already real:

- owner/admin DTOs expose secret-free aggregate sync metadata;
- `resolveEffectiveGrants` enforces capability scope AND owner preference;
- the graph traces the same grant decision into live tools, cached reads, source context, monitors,
  calendar writes, and audited settings routes;
- Google and generic IMAP connect/sync machinery already exists;
- onboarding already contains an IMAP credential form for Yahoo, Proton, iCloud, and Fastmail.

The settings surface does not use that IMAP flow. It instead advertises GitHub, Apple, and
`Other (OAuth)` through a false “same OAuth flow” message. Health reduces independent email/calendar
outcomes to `Partial`, hides prior successful freshness after a failure, calls a deployment safety
cap merely “message cap reached,” and offers reconnect only for Google auth failures.

## Goals

1. Name affected capabilities, bounded cause/origin, last successful capability sync, freshness
   impact, and the next truthful action.
2. Offer retry, reconnect, or wait/configure guidance only when that action can help.
3. Reuse the shipped generic IMAP connect path from Connected accounts.
4. Remove `Other (OAuth)` and the false shared-OAuth claim.
5. Distinguish shipped iCloud Mail-over-IMAP from the fuller iCloud Mail + Calendar #1003 delivery;
   neither is generic OAuth.
6. Re-verify feature grants end to end without changing the established authorization model or
   exposing connector secrets.

## Non-goals

- No new OAuth provider, provider marketplace, generic arbitrary-host IMAP form, or Outlook XOAUTH2.
- No Apple Calendar implementation; that remains #1003.
- No admin reconnect/sync/private-data capability.
- No raw provider error, provider payload, token, password, message content, calendar title, or
  external id in health metadata.
- No change to `AccessContext`, RLS ownership, cached-read grant semantics, or module boundaries.
- No `tests/uat/**`, `docs/coordination/**`, #1042 registry file, or module-distribution work.

## Resolved Decisions

### 1. Persist per-capability success timestamps, not a new health subsystem

Add two nullable safe-metadata columns to `app.connector_accounts` in a new connectors migration:

- `last_email_sync_success_at`
- `last_calendar_sync_success_at`

Google updates each timestamp independently only when that granted capability completes without a
capability error. IMAP updates email only. A truncated email run does not advance email success,
because the cache may not be fully fresh. Disabled/unscoped capabilities do not advance or clear a
timestamp. Failure never destroys the previous success time.

Extend existing aggregate counts with `calendarFailures` where needed. Do not add raw error text or a
per-item health table.

### 2. Health presentation is a pure mapping over bounded metadata

The browser maps existing bounded labels/counts plus the two timestamps into:

- affected capability: Email, Calendar, or both;
- origin: Jarv1s deployment limit (`truncated`), upstream authorization (`auth-error`), upstream
  provider (`email-error`/`calendar-error` and item variants), or unknown bounded failure;
- last successful capability sync and explicit stale/possibly stale wording;
- one next action.

`Partial` may remain a compact badge, but it cannot be the explanation. Examples:

- “Email may be stale. Jarv1s stopped at this deployment's per-sync message limit. Last complete
  email sync: … Increase `JARVIS_EMAIL_SYNC_CAP` or wait for the next bounded sync.”
- “Calendar sync failed at Google. Email completed. Reconnect if authorization was revoked; otherwise
  retry.”
- “IMAP credentials were rejected. Re-enter this provider's app password.”

Unknown states say what is unknown and offer Retry; they never fabricate a provider or limit owner.

### 3. Add one owner-scoped generic retry route

Add `POST /api/connectors/accounts/:id/sync`.

Inside one `withDataContext` call, resolve the authenticated actor and find that actor-visible active
account. Only then select the queue by the stored provider type. The request accepts no provider,
actor, queue, credential, or command parameter.

- Google payload remains actor metadata only.
- IMAP payload contains actor id, connector account id, kind, and idempotency key only.
- `pg-boss.send()` null returns `deduped:true` rather than claiming a new job.
- revoked/missing/other-owner accounts return the same not-found result.
- rate-limit by authenticated principal.

This replaces no worker and introduces no content-bearing job.

### 4. Reconnect is provider-aware and reuses existing connect services

Google continues through the existing `GoogleConnect` flow. IMAP reconnect opens the same extracted,
shared IMAP credential form used by onboarding; successful connect upserts the owner account and
clears password component state immediately.

The shared form sends credentials only to the existing bounded test/connect routes. Raw IMAP/SMTP
errors remain mapped to `ok | auth_failed | tls_failed | unreachable` and are never logged or echoed.

### 5. Provider picker reflects what is actually shipped

Connected accounts shows:

- Google — active OAuth setup;
- Yahoo Mail, Proton Mail, Fastmail, and **iCloud Mail** — active existing generic
  IMAP/app-password setup;
- iCloud Calendar and the combined iCloud Mail + Calendar delivery — planned in #1003, stated next
  to the mail-only option with no claim that it uses Google OAuth;
- Outlook — unavailable until the existing XOAUTH2 follow-up, if it remains visible at all.

Remove GitHub from this email/calendar account picker, remove `Other (OAuth)`, and remove all “same
OAuth flow” copy. The existing iCloud IMAP tile stays active but is relabeled **Mail only** with a
#1003 Calendar/fuller-delivery note so the two surfaces do not contradict each other.

### 6. Feature grants stay on the existing two-gate model

No authorization redesign is needed. The build must prove, rather than assume:

1. only the account owner can GET/PUT grants;
2. effective value remains `account scope ∧ stored owner preference`;
3. revocation takes effect on live email/calendar tools, cached reads, source context, monitors, and
   calendar write;
4. re-enable restores retained cached reads without a sync;
5. missing service wiring fails loudly;
6. responses, logs, audit metadata, jobs, exports, and prompts contain no connector secret.

The toggle copy changes from broad “Jarvis may read…” to precise capability effects, including cached
and live use. Admin oversight remains safe-metadata-only.

## Security Boundaries

| Threat                                                  | Required control                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Retry another user's account                            | Owner-visible lookup under `DataContextDb`; missing and unauthorized are indistinguishable.   |
| Job leaks private content or secrets                    | Fixed metadata-only payload; no request body beyond route id.                                 |
| UI exposes an IMAP password after submit                | Password stays component-local, uses password input, and is cleared on success/unmount.       |
| Raw provider transcript escapes                         | Existing bounded probe enums and sync labels only; never serialize/log error objects.         |
| Grant toggle lies while a sibling read path bypasses it | Existing required service plus focused tests across every traced consumer.                    |
| Admin gains private connector access                    | No admin retry/reconnect/grant route; oversight remains aggregate safe metadata.              |
| Freshness claims overstate partial sync                 | Capability timestamps advance independently only on complete capability success.              |
| Provider tile promises unsupported auth                 | Active tiles map to existing routes; planned tiles have no action and name their issue/scope. |

## Exact Owned Product Paths

- `packages/connectors/sql/0165_connector_capability_freshness.sql`
- `packages/connectors/src/manifest.ts`
- `packages/db/src/types.ts`
- `packages/shared/src/connectors-api.ts`
- `packages/connectors/src/repository.ts`
- `packages/connectors/src/sync-jobs.ts`
- `packages/connectors/src/imap-sync-jobs.ts`
- `packages/connectors/src/routes.ts`
- `apps/web/src/api/connectors-client.ts`
- `apps/web/src/api/query-keys.ts`
- `apps/web/src/connectors/imap-connect-form.tsx`
- `apps/web/src/onboarding/google-connector-step.tsx`
- `apps/web/src/settings/settings-connector-sync.ts`
- `apps/web/src/settings/settings-personal-data-panes.tsx` — only after #987 merge/rebase
- `apps/web/src/styles/settings-panes.css`

The migration number is reserved by this plan at the grounded branch tip; after the mandatory #987
rebase, the builder must stop and coordinate if `0165` has landed rather than silently renumbering or
editing another module's migration.

## Verification and Live-path Proof

- Migration/DTO: timestamps default null, owner/admin responses expose them, secrets remain absent.
- Sync: email/calendar success advances independently; failure, disabled scope, and truncation retain
  prior timestamps.
- Retry: owner succeeds/dedupes truthfully; other-owner, revoked, unauthenticated, and unsupported
  accounts fail without enqueue.
- UI: each bounded health case names capability, origin, freshness, and correct action; provider picker
  exposes real IMAP paths and no generic OAuth promise.
- Grants: existing unit/integration suites cover all traced read/write/monitor paths and secret scans.
- Live path: after #987 is merged, navigate normally to Settings → Connected accounts on a deployed
  instance; connect one generic IMAP provider, exercise a bounded failed and successful retry, verify
  freshness/action copy, toggle Email access off/on, and prove the live/cached behavior changes. Do not
  deep-link or modify `tests/uat/**`.

## Exit Criteria

- #987 is merged and the #995 branch is rebased before the shared settings file is edited.
- Every #995 acceptance item is covered without adding provider/auth scope.
- Connector secrets remain encrypted and absent from every prohibited channel.
- Owner and RLS boundaries remain unchanged; admin stays metadata-only.
- `pnpm verify:foundation`, design-token checks, focused tests, adversarial security QA, and live-path
  proof pass.
