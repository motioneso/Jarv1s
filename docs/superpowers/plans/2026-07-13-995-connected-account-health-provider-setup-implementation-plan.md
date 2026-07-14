# Connected-account Health and Provider Setup Implementation Plan (#995)

> **Hard build gates:** (1) approve
> `docs/superpowers/specs/2026-07-13-995-connected-account-health-provider-setup-security-design.md`;
> (2) merge #987; (3) rebase this build on the merged #987 result before touching
> `apps/web/src/settings/settings-personal-data-panes.tsx`.

**Goal:** Make connected-account failures actionable, expose shipped IMAP setup, keep Apple truthful,
and prove grants without weakening owner/secret boundaries.

**Grounded on:** `676e99cd` (preflight current with `origin/main` on 2026-07-13).

## Collision and Scope Checkpoint

- [ ] Confirm #987 is merged into the target branch and run `pnpm audit:preflight`.
- [ ] Re-read the merged `apps/web/src/settings/settings-personal-data-panes.tsx` before editing it.
- [ ] Confirm `packages/connectors/sql/0165_connector_capability_freshness.sql` is still unclaimed;
      if not, stop and notify the UX Coordinator.
- [ ] Confirm `git status --short` is understood and stage only task paths.
- [ ] Do not touch `tests/uat/**`, `docs/coordination/**`, or
      `apps/web/src/settings/settings-module-registry-section.tsx`. If the registry file becomes
      necessary, stop and notify the UX Coordinator before proceeding.

## Task 1: Add safe per-capability freshness metadata

**Files:**

- Create `packages/connectors/sql/0165_connector_capability_freshness.sql`
- Modify `packages/connectors/src/manifest.ts`
- Modify `packages/db/src/types.ts`
- Modify `packages/shared/src/connectors-api.ts`
- Modify `packages/connectors/src/repository.ts`
- Modify `tests/integration/connectors.test.ts`

- [ ] First assert the two nullable columns, DTO/schema fields, null defaults, owner/admin safe
      metadata, and absence of encrypted/token/password fields.
- [ ] Add `last_email_sync_success_at` and `last_calendar_sync_success_at`; grant only the existing
      owner/worker roles the minimum column access. Preserve RLS unchanged.
- [ ] Extend `ConnectorSyncCounts` only with bounded aggregate `calendarFailures`; reject arbitrary
      keys/strings at the serializer boundary.
- [ ] Select/serialize the two timestamps through the existing owner and admin safe account queries.
- [ ] Run `JARVIS_PGDATABASE=jarv1s_995_health pnpm vitest run tests/integration/connectors.test.ts`.
- [ ] Commit only these paths with a user-facing summary: account health now retains last successful
      email/calendar freshness.

## Task 2: Advance freshness only on complete capability success

**Files:**

- Modify `packages/connectors/src/repository.ts`
- Modify `packages/connectors/src/sync-jobs.ts`
- Modify `packages/connectors/src/imap-sync-jobs.ts`
- Modify `tests/integration/google-sync-orchestration.test.ts`
- Modify `tests/integration/connectors-imap.test.ts`

- [ ] Add repository inputs that can advance email and calendar timestamps independently without
      clearing prior values.
- [ ] Write failing cases for: both succeed, email-only failure, calendar-only failure, auth failure,
      disabled/unscoped capability, IMAP success/failure, and truncated email.
- [ ] Google advances each granted capability only when that phase has no error; IMAP advances email
      only; truncation does not advance email.
- [ ] Persist `calendarFailures` as an aggregate count and retain bounded `lastSyncError`; never persist
      raw provider errors.
- [ ] Run the two focused integration files and secret-substring assertions.
- [ ] Commit only these five paths.

## Task 3: Add owner-scoped generic retry

**Files:**

- Modify `packages/shared/src/connectors-api.ts`
- Modify `packages/connectors/src/routes.ts`
- Modify `apps/web/src/api/connectors-client.ts`
- Modify `apps/web/src/api/query-keys.ts`
- Modify `tests/integration/connectors.test.ts`
- Modify `tests/integration/connectors-imap-routes.test.ts`

- [ ] Add the fixed `POST /api/connectors/accounts/:id/sync` contract and principal rate limit.
- [ ] In `withDataContext`, resolve only an active actor-visible account; dispatch by stored provider
      type and enqueue metadata-only payloads with existing singleton behavior.
- [ ] Return `{ enqueued, deduped }`; do not return job payload, provider response, or credential state.
- [ ] Prove owner enqueue, truthful dedupe, unauthenticated rejection, other-owner/revoked not-found,
      unsupported-provider rejection, and no-job-on-denial.
- [ ] Add the web client and mutation key only after the route is green.
- [ ] Run both route-focused integration files and typecheck.
- [ ] Commit only these paths.

## Task 4: Extract the existing IMAP form for two real consumers

**Files:**

- Create `apps/web/src/connectors/imap-connect-form.tsx`
- Modify `apps/web/src/onboarding/google-connector-step.tsx`
- Add/modify the smallest focused frontend test file selected after checking current test ownership;
  prefer extending an existing onboarding connector test over creating a broad harness.

- [ ] Move the existing provider data and IMAP credential/test/connect UI into one focused component;
      do not duplicate the form or add an abstraction beyond its onboarding/settings consumers.
- [ ] Keep Yahoo, Proton, Fastmail, and iCloud Mail active. Label iCloud as mail-only and render
      Calendar/the combined Mail + Calendar delivery as planned in #1003.
- [ ] Preserve password input type, bounded error copy, success invalidations, and immediate password
      state clearing.
- [ ] Prove no password value re-renders after success/unmount and no raw error reaches the UI.
- [ ] Run the focused frontend test and web typecheck.
- [ ] Commit only the component, onboarding file, and chosen test.

## Task 5: Make Connected accounts provider-aware and actionable

**Files:**

- Modify `apps/web/src/settings/settings-connector-sync.ts`
- Modify `apps/web/src/settings/settings-personal-data-panes.tsx` (post-#987 version only)
- Modify `apps/web/src/styles/settings-panes.css`
- Modify `tests/unit/settings-connector-sync.test.tsx`

- [ ] Expand the pure health view model to return affected capabilities, origin, freshness copy, and
      exactly one action: retry, reconnect, wait/configure, or none.
- [ ] Map Google reconnect to `GoogleConnect`, IMAP reconnect to the extracted form, and Retry to the
      new generic route; refresh account state while a sync is in flight.
- [ ] Replace the picker with active Google/Yahoo/Proton/Fastmail/iCloud Mail choices plus the
      non-actionable #1003 iCloud Calendar/fuller-delivery note. Remove GitHub, `Other (OAuth)`, and
      all shared-OAuth copy.
- [ ] Make grant copy precise about live and cached capability use; do not alter toggle semantics.
- [ ] Preserve all #987 merged behavior while resolving the single shared-file edit.
- [ ] Cover truncated/deployment limit, auth/upstream, email-only, calendar-only, both, unknown,
      never-synced, revoked, syncing, retry/dedupe, and provider-aware reconnect states.
- [ ] Run `pnpm vitest run tests/unit/settings-connector-sync.test.tsx`, web typecheck, and
      `pnpm check:design-tokens`.
- [ ] Commit only these four paths.

## Task 6: Re-prove feature grants end to end

**Files (tests only unless a failure exposes a root-cause product defect):**

- `tests/unit/connectors-feature-grants.test.ts`
- `tests/integration/feature-grants-read-tools.test.ts`
- `tests/integration/connectors.test.ts`
- `tests/integration/google-sync.test.ts`
- `tests/integration/connectors-imap.test.ts`
- Existing focused calendar-write, live-tools, source-context, and monitor grant tests discovered from
  the current branch

- [ ] Prove owner-only GET/PUT, scope ∧ preference, audited mutation metadata, and other-owner 404.
- [ ] Prove disable/re-enable across cached email/calendar reads, live tools, source context, monitors,
      and calendar writes; remove one required service wire in a negative harness and confirm loud
      failure.
- [ ] Scan responses, logs, jobs, exports, and prompt fixtures for seeded connector secrets.
- [ ] If a product defect is found, stop and update the approved spec/owned-path list before adding a
      new product file; do not scatter guards into each caller.

## Task 7: Adversarial security QA and live-path proof

- [ ] Run `pnpm audit:preflight` and record the final SHA.
- [ ] Attempt retry, reconnect, revoke, and grant operations as unauthenticated, other-owner, owner,
      and admin. Admin must not gain owner actions through oversight.
- [ ] Verify denied retry creates no pg-boss row and every accepted payload is metadata-only.
- [ ] Seed recognizable password/token/provider-error strings and prove absence from responses, logs,
      jobs, exports, and prompts.
- [ ] Run all focused tests, `pnpm check:design-tokens`, and `pnpm verify:foundation`.
- [ ] On a deployed post-#987 instance, navigate normally to Settings → Connected accounts; connect
      Yahoo/Proton/Fastmail through IMAP, exercise success/failure/dedupe, verify capability freshness
      and recovery copy, toggle grants off/on, and confirm actual live/cached behavior changes. Capture
      evidence outside `tests/uat/**`; do not deep-link.

## Completion Check

- [ ] #995 diff is based on merged #987 and contains only approved owned paths.
- [ ] #1042 registry lane remains untouched.
- [ ] No unsupported OAuth or Apple capability is promised.
- [ ] Secret, RLS, owner, `DataContextDb`, `AccessContext`, and metadata-only job invariants remain
      intact.
