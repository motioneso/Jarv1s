# Relay: UX #995 Connected Accounts Cleanup

Worktree: `/home/ben/Jarv1s/.claude/worktrees/ux-995-connected-accounts-cleanup`
Branch: `ux/995-connected-accounts-cleanup`
Coordinator label: `UX Coordinator` (resolve fresh by label + `agent_session.value`, never a `w…-N` pane number)
Risk tier: security (touches connector credential UI)

Spec: `docs/superpowers/specs/2026-07-14-...` (see handoff below for exact name)
Plan: `docs/superpowers/plans/2026-07-14-ux-995-connected-accounts-cleanup.md`
Original handoff: `docs/superpowers/handoffs/2026-07-14-ux-995-connected-accounts-cleanup.md`

## Done (committed)

- Task 1: `c51bb2a9` — exported `IMAP_PROVIDERS`/`ImapProvider` from onboarding for reuse.
- Tasks 2–5: `27ad50bb` — "feat(settings): rebuild connected-accounts picker and IMAP flow (#995)"
  - `apps/web/src/settings/settings-imap-connect.tsx` (new) — `ImapConnect` component, settings-surface twin of onboarding IMAP flow.
  - `apps/web/src/settings/settings-personal-data-panes.tsx` — `ServicePicker` rebuilt (Google / Email (IMAP) / GitHub "Coming soon · #1061" disabled tile); removed Apple + Other (OAuth); `flow` state now `null | "picker" | "google" | "imap"`; `AccountRow` reconnect routes to `"google"` or `"imap"` by `providerType`.
  - `apps/web/src/settings/settings-connector-sync.ts` — `getConnectorAccountHealth` copy rewritten (provider-aware alert text, auth-failure branch).
  - `tests/e2e/mock-connectors-api.ts` — added IMAP test-connection/connect route mocks.
  - `tests/e2e/connect-imap.spec.ts` (new) — 3 Playwright tests: picker contents (no Apple/Other-OAuth, GitHub disabled+#1061), IMAP connect happy path (Fastmail), IMAP reconnect opens `ImapConnect` not `GoogleConnect`.

Constraints already satisfied: zero new deps (no RTL/vitest for web — Playwright only), GitHub kept as disabled "Coming soon" tile mapped to #1061 (not removed), Apple/Other-OAuth fully removed, reused existing `jds-btn`/`onb-*`/`gflow__*`/`provpick__*` CSS classes only.

## Not yet done — Task 6 + wrap-up

1. Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck` (all previously clean on the touched files individually — re-run on full repo to confirm).
2. `git fetch origin main && git rebase origin/main` (not yet done this session).
3. Run the new + adjacent e2e specs: `pnpm exec playwright test tests/e2e/connect-imap.spec.ts tests/e2e/connect-google.spec.ts` — **never executed yet**, do this first, fix any failures.
4. Confirm `FeatureGrantSwitch` / feature-grants behavior unaffected by the `ServicePicker`/`ConnectedPane` changes (no dedicated existing tests found for it — likely a structural read-through, not a new test).
5. Full gate: `pnpm verify:foundation`.
6. Manual UAT per plan: desktop + narrow viewport, exercise picker → IMAP connect → reconnect paths in a real dev instance (per repo rule: e2e + UAT required for UI/UX features before done).
7. Secret-egress grep across all touched/new files before wrap-up (confirm no raw IMAP password/API errors ever surfaced to frontend/logs).
8. Then invoke `coordinated-wrap-up`: push (after step 1–2 pass clean), open PR, report PR + evidence to `UX Coordinator`. Do not merge, touch the board, or close the issue — coordinator's job.

## Notes for successor

- No RTL/component-test framework exists in this repo — don't add one. Playwright (`tests/e2e/*.spec.ts`, root-level) + `tests/unit` pure/SSR assertions are the only test surfaces used here.
- `ConnectorAccountDto` has no sub-provider field for IMAP (yahoo/proton/icloud/fastmail) — reconnect on an IMAP account intentionally opens the provider picker step (`ImapConnect` without `initialProvider`), not a specific provider. This was anticipated in the plan; no schema change needed.
- Coordinator already notified of this relay (message sent to `UX Coordinator` pane, confirmed landed).
