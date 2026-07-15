# Plan — UX #995 Connected Accounts Cleanup

Spec: `docs/superpowers/specs/2026-07-14-connected-accounts-cleanup.md`
Branch: `ux/995-connected-accounts-cleanup` (verified current at `2c841e54`, no drift found)

## Scope verification (done)

- `settings-personal-data-panes.tsx`: `CONNECT_SERVICES` still lists Google/GitHub/Apple/`Other
(OAuth)`; only Google is wired (`s.go`). Apple/GitHub/Other fall through to a toast claiming
  "same OAuth flow — coming soon". Confirmed stale/broken exactly as spec describes.
- `settings-connector-sync.ts`: labels `Partial`, `Needs attention` (used for both `lastSyncStatus
=== "failed"` and `account.status === "error"`), `message cap reached` all present, vague as
  spec describes. `canReconnect` is Google-only today (IMAP accounts never offer reconnect even on
  auth failure) — spec requires reconnect only when it can actually repair, so this needs an IMAP
  auth-failure case added, not merely relabeling.
  the classifier, not new secret-shape work.
- `google-connector-step.tsx`: exports nothing reusable today (`IMAP_PROVIDERS`, mutations, mode
  JSX all module-local). `settings-google-connect.tsx` is the existing precedent for "settings
  reimplements onboarding's flow UI, reusing the same API-layer hook" (`GoogleConnect` wraps
  `useGoogleConnectFlow`) — same pattern applies for IMAP.
- No shared API/contract gap found: `testImapConnection`/`connectImapConnection` (in `../api/
client`) already return sanitized `result` enums (`ok`/`auth_failed`/`tls_failed`/other), no raw
  provider errors. No coordinator escalation needed for scope.

## Task 1 — Export reusable IMAP provider list

Files: `apps/web/src/onboarding/google-connector-step.tsx`

- Export `IMAP_PROVIDERS` and `ImapProvider` type (currently module-local). No behavior change.
- No test needed (pure export, covered transitively by existing onboarding tests still passing).

## Task 2 — `ImapConnect` settings component (TDD)

Files: `apps/web/src/settings/settings-imap-connect.tsx` (new, sibling to
`settings-google-connect.tsx`, same pattern), `apps/web/src/settings/settings-imap-connect.test.tsx`

- Mirrors `GoogleConnect`: provider tile picker (reusing exported `IMAP_PROVIDERS`) → credential
  entry → `testImapConnection`/`connectImapConnection` (imported from `../api/client`, not
  reimplemented) → `onBack`.
- Tests (component, RTL):
  1. Renders all 4 `IMAP_PROVIDERS` tiles, none pre-selected.
  2. Selecting a provider shows its `prerequisite` copy and credential fields.
  3. "Test connection" disabled until username+password filled; on `auth_failed`/`tls_failed`/
     network result, shows the same sanitized copy used today (no raw error text, no credential
     value ever rendered back).
  4. "Connect" calls `connectImapConnection`, invalidates `GOOGLE_CONNECT_SUCCESS_QUERY_KEYS` (same
     keys `GoogleConnect`/`GoogleConnectorStep` invalidate, since accounts.done is shared), then
     calls `onBack`.
  5. Password field never logs/serializes into a toast or DOM text node outside the input value
     (secret-egress guard, per spec's security invariants).

## Task 3 — Fix `ServicePicker` (TDD)

Files: `apps/web/src/settings/settings-personal-data-panes.tsx`,
`apps/web/src/settings/settings-personal-data-panes.test.tsx` (existing or new)

- Replace `CONNECT_SERVICES` (Google/GitHub/Apple/Other-OAuth) with: Google (existing `onGoogle`
  handler, working) + **Email (IMAP)** (new `onImap` handler opening `ImapConnect`, working) +
  **GitHub** (non-clickable, `Coming soon`, tracked by issue #1061 — per UX Coordinator
  correction). Apple and `Other (OAuth)` are removed entirely (no tracked issue, false-claim
  behavior per spec).
- GitHub tile: no `onClick` handler / not a `<button>` action — render as a disabled/labeled row so
  it cannot behave like a broken button (spec: "must not behave like a broken button"). Link or
  reference issue #1061 in the tile copy or an accessible label so the commitment is verifiable in
  the UI, not just in code comments.
- Wire `ConnectedPane`'s `flow` state to add an `"imap"` branch rendering `ImapConnect`.
- Tests:
  1. Picker renders exactly Google, Email (IMAP), GitHub (Coming soon) — no Apple, no
     Other (OAuth); no `toast(... coming soon)` fallback path remains reachable for any entry.
  2. Clicking Email (IMAP) opens `ImapConnect`; `onBack` returns to the pane.
  3. GitHub tile is present, labeled `Coming soon`, not clickable/actionable (no handler fires on
     click/keypress), and its accessible text or tooltip references issue #1061.

## Task 4 — Account health copy rewrite (TDD)

Files: `apps/web/src/settings/settings-connector-sync.ts`,
`apps/web/src/settings/settings-connector-sync.test.ts` (existing — extend)

- Rewrite `getConnectorAccountHealth` labels/alerts to name: capability, cause/owner, freshness
  when available, and next action — for each existing branch (revoked, syncing, sync-failed,
  status-error, partial/capped, awaiting-first-sync, healthy). Reuse `syncAlert`/`syncErrorLabel`/
  `syncCountsLabel` helpers; extend, don't duplicate.
- Add `canReconnect: true` for IMAP auth-failure states (`lastSyncError === "auth-error"`-equivalent
  for IMAP, or `status === "error"` with `providerType !== "google"` — confirm the actual IMAP
  auth-failure signal in `ConnectorAccountDto`/`lastSyncError` values before coding this branch;
  IMAP reconnect target = `ImapConnect`, not `GoogleConnect`).
- Tests: one case per health state (healthy, first-sync, partial/capped, auth failure — both
  Google and IMAP, provider failure, deployment/status-error) asserting label+alert text contains
  capability/cause/action, contains no secret material, and `canReconnect` is correct per provider.

## Task 5 — `AccountRow` reconnect wiring (TDD)

Files: `apps/web/src/settings/settings-personal-data-panes.tsx` (extend, no new file),
component test extension.

- `onReconnect` currently always opens `GoogleConnect`. Branch on `account.providerType`: Google →
  existing behavior; IMAP → open `ImapConnect` pre-selected to that account's provider if
  recoverable (confirm during build whether `ConnectorAccountDto` carries enough to preselect; if
  not, open the picker step — no schema change).
- Tests: reconnect on a Google account opens `GoogleConnect`; reconnect on an IMAP account opens
  `ImapConnect`, not `GoogleConnect`.

## Task 6 — Feature grants regression check

No code change expected (spec: "verify them end to end rather than changing their authorization
model"). Confirm existing `FeatureGrantSwitch` tests still pass unmodified after Tasks 3–5; add one
assertion only if IMAP accounts with email scope don't already exercise this path in tests.

## Verification (exit criteria)

- `pnpm --filter web test` for the touched files, then full `pnpm verify:foundation`.
- Manual UAT (desktop + narrow) per spec: every visible picker action works or is tracked
  `Coming soon`; complete one real IMAP test+connect; exercise one recovery (reconnect) action.
- Confirm no secret material in any new test fixture, toast, or log output (grep new/changed files
  for password/token echoes before wrap-up).
