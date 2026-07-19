# #1188 — Connector onboarding parity and action repairs

**Status:** Approved by Ben from live Agentation feedback on 2026-07-19  
**Issue:** #1188  
**Annotations:** `mrs67gef-h4qiyt`, `mrs69zpx-rxknnt`, `mrs6arkr-3c85gx`,
`mrs6bbol-p7gxya`  
**Tier:** Security — OAuth launch and app-password credential surfaces  
**Builds on:** existing Google OAuth and generic IMAP connector designs

## Problem

Connector onboarding visually promotes Google over other available services, gives IMAP users only a
one-line app-password prerequisite, requires two clicks to open Google's consent screen, and cannot
leave the connected summary when **Connect another account** is selected.

## Decisions

1. Use one provider-card hierarchy in the connector picker. Google and available IMAP providers have
   equal visual weight; capability/prerequisite differences stay in their descriptions.
2. Add short provider-specific app-password steps beside the credential form, backed by links to the
   provider's official setup documentation. Proton continues to describe Bridge credentials rather
   than pretending it uses a normal account app password. Keep this content local to the existing
   onboarding provider metadata; do not create a connector framework.
3. **Open consent screen** is one deliberate action. Preserve the browser user gesture by opening a
   blank target synchronously, request the authorization URL, then navigate that target. Close it on
   request failure. If popups are blocked, retain an explicit direct link and an actionable message;
   never require an unexplained second click.
4. **Connect another account** enters an explicit picker/add-account mode that takes precedence over
   the fact that accounts already exist. Existing connected accounts remain visible again when the
   user cancels or completes the new flow.
5. Reuse the current OAuth/IMAP routes and encrypted credential handling. No credential value enters
   logs, screenshots, URLs controlled by Jarvis, test fixtures, client responses, or prompts.

## Expected scope

- `~/Jarv1s/apps/web/src/onboarding/google-connector-step.tsx`
- `~/Jarv1s/apps/web/src/connectors/use-google-connect-flow.ts` only if the one-click launch needs a
  reusable success callback; do not change the backend contract without escalation
- Onboarding-local CSS and focused unit/E2E coverage

## Non-goals

- No new provider, OAuth callback, credential schema, secret storage, sync behavior, connector API,
  or calendar capability.
- No attempt to make provider prerequisites identical; only their product hierarchy is equal.
- No real credentials in automated or visual proof.

## Acceptance

- [ ] Available connector cards have equal hierarchy and remain keyboard/screen-reader operable.
- [ ] Each app-password provider shows accurate actionable steps and an official help link; Proton
      truthfully describes Bridge.
- [ ] One click launches Google consent when allowed; blocked-popup and request-failure paths recover
      without a dead control or leaked raw error.
- [ ] Connect another account opens the picker even while existing accounts remain connected.
- [ ] Every visible onboarding button/link completes its action or exposes a truthful disabled/error
      reason; no-op controls fail acceptance.
- [ ] A low-cost visual-QA agent clicks every touched provider, consent, cancel, test, connect, and
      add-account control in an isolated live/UAT account at desktop and narrow widths.
- [ ] Independent adversarial QA verifies OAuth target handling and secrets-never-escape behavior;
      Ben explicitly signs off before merge.
