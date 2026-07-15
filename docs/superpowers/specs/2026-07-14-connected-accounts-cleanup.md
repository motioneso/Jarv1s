# Connected Accounts Cleanup

**Issue:** #995  
**Status:** Approved by Ben on 2026-07-14  
**Tier:** Security — this UI accepts existing connector credentials; no new credential mechanism

## Problem

Connected Accounts exposes options that do not work and account states that do not tell users what
failed or how to recover. Every visible setup action should work, and every failure should identify
the affected capability and the next useful action.

## User

All users managing integrations through **Settings → Connected accounts**.

## Locked product decisions

- Clean up the existing settings surface; do not redesign Settings or create a new account framework.
- Expose the existing generic IMAP setup from Connected Accounts.
- Remove the Apple-specific setup option. Apple users use the generic IMAP path; no Apple-only flow.
- Remove the unplanned `Other (OAuth)` option and its false “same OAuth flow” claim.
- Keep legitimate `Coming soon` commitments when they have a concrete GitHub issue. Do not remove
  tracked promises merely to make the screen look finished. A scrapped feature is removed entirely.
- Keep the UI concise. Prefer a useful action over explanatory prose.

## Existing machinery to reuse

- `apps/web/src/settings/settings-personal-data-panes.tsx` owns `ConnectedPane` and its current
  `ServicePicker`; change this existing surface instead of adding another settings route.
- `apps/web/src/onboarding/google-connector-step.tsx` already implements preset-based generic IMAP
  credential entry, bounded connection testing, connection creation, and safe result copy.
- Existing IMAP presets and connector APIs remain canonical. Do not duplicate provider definitions,
  credential transport, secret storage, or error mapping.
- `apps/web/src/settings/settings-connector-sync.ts` owns the shared account-health classifier used by
  personal Connected Accounts and admin oversight. Improve the shared classifier once; do not patch
  individual rows with divergent status rules.

## MVP behavior

### Provider picker

- Google continues to open its working OAuth flow.
- A generic **Email (IMAP)** action opens the existing preset-based IMAP setup and supports its
  existing test-then-connect behavior.
- Apple and `Other (OAuth)` are absent.
- Any unavailable provider that remains visible is clearly `Coming soon` and maps to a concrete open
  GitHub issue. It must not behave like a broken button or claim a fake OAuth flow.

### Account health

- Replace vague standalone states such as `Partial`, `message cap reached`, and `Connection needs
  attention` with concise copy that names:
  1. the affected capability or sync,
  2. the known cause or limit owner (Jarv1s, provider, or deployment),
  3. freshness/last-success impact when safe metadata supports it, and
  4. a working next action: reconnect, retry, wait, or check deployment configuration.
- Reconnect is offered only when it can actually repair that provider's state.
- Feature-grant controls continue to govern their existing behavior; verify them end to end rather
  than changing their authorization model.

## Security invariants

- Reuse the existing encrypted connector credential path. No new secret shape or storage.
- Connector secrets, passwords, tokens, and raw provider errors never enter responses, logs, job
  payloads, exports, prompts, analytics, screenshots, or status copy.
- Test-connection results stay bounded and sanitized.
- No RLS, `AccessContext`, `DataContextDb`, module-boundary, or job-payload changes are expected.
- If implementation proves a shared API contract change is necessary, stop and obtain coordinator
  approval before widening scope.

## Verification

- Unit/component tests prove Apple and `Other (OAuth)` are absent and every remaining picker action
  has either a working handler or a tracked `Coming soon` state.
- Tests exercise representative healthy, first-sync, partial/capped, auth failure, provider failure,
  and deployment failure states. Copy identifies cause/impact/action without secret material.
- Settings tests drive generic IMAP test and connect through the existing APIs, including sanitized
  auth/TLS/unreachable failures.
- Verify feature grants still govern the capabilities they label.
- Full repository gate and security audit pass.
- Live UAT on desktop and narrow layouts clicks every visible provider action, completes a real
  generic IMAP setup path, and exercises at least one actionable recovery state.

## Non-goals

- New connector backend, OAuth provider, sync engine, credential format, or database migration.
- Apple-specific setup or calendar support.
- Building any tracked `Coming soon` provider in this issue.
- Full Settings redesign or additional explanatory panels.
