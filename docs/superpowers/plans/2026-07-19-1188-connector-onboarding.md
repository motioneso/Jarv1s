# Plan — #1188 connector onboarding parity and action repairs

Spec: `docs/superpowers/specs/2026-07-19-1188-connector-onboarding-feedback.md`
Handoff: `docs/superpowers/handoffs/2026-07-19-1188-agentation-connectors.md`
Coordinator pre-approval received (verbatim, in-chat) for this scope: equal provider-card
hierarchy; local provider-specific official help/steps; one-click consent via synchronous
blank popup then navigate/close-on-error with blocked-popup fallback; explicit add-account
mode overriding connected summary; focused unit/E2E with fake credentials only; no backend/
auth contract/secret-storage changes.

Grounding done against live branch — all four spec bugs confirmed current:

- `apps/web/src/onboarding/google-connector-step.tsx` render-order bug: `mode === "connected"
|| connected` always wins before the picker return, so "Connect another account"
  (`setMode("picker")`, line ~509) is a no-op once any account exists.
- Two-click OAuth: lines ~268-287 swap `<button onClick={startAuthorization}>` for an
  `<a href={authUrl} target="_blank">` only after `authUrl` resolves async — two clicks.
- Visual hierarchy: Google gets `.onb-prov` (full card); IMAP providers get `.onb-provsec` /
  `.onb-provmini` (dashed, smaller, "More services" 3-col grid) — see
  `apps/web/src/styles/onboarding-design.css` ~540-670 and `onboarding-connectors.css`.
- IMAP prerequisite is one plain sentence (`imapProvider.prerequisite`, render ~361-366), no
  steps, no doc link.
- `apps/web/src/onboarding/member-connector-step.tsx` is a thin passthrough wrapper around
  `GoogleConnectorStep` — no separate fix needed, benefits automatically.
- `apps/web/src/settings/settings-google-connect.tsx` shares `useGoogleConnectFlow` and has the
  _same_ two-click bug, but is out of scope (collision: #1186 owns Settings surfaces later).
  The one-click fix must be **additive-only** in the hook (new `openConsentScreen` +
  `popupBlocked`, existing `startAuthorization`/`authUrl` untouched) so Settings' behavior and
  its e2e (`tests/e2e/connect-google.spec.ts`) are unaffected.

Verified official provider doc links for IMAP app-password steps:

- Yahoo: https://help.yahoo.com/kb/SLN15241.html
- Proton (Bridge, not a generic app password): https://proton.me/support/protonmail-bridge-install
- iCloud: https://support.apple.com/en-us/102654
- Fastmail: https://www.fastmail.help/hc/en-us/articles/360058752854-App-passwords

Existing assertions that MUST keep passing unmodified:

- `tests/e2e/onboarding.spec.ts` "onboarding offers IMAP providers..." — exact Proton
  prerequisite regex + "Passwords are encrypted..." hint text. Keep the current `prerequisite`
  sentence verbatim as the lead line; add steps/link below it, don't replace it.
- `tests/e2e/connect-google.spec.ts` — Settings flow, untouched by hook additivity.

## Tasks (TDD, one commit each, green before moving on)

1. **Fix add-account mode bug.** Reorder `GoogleConnectorStep` render branches so
   `mode === "picker"` is checked before the `connected` short-circuit; give the connected
   picker a "Cancel" affordance back to the summary; cancel handlers in connecting/imap modes
   return to `"connected"` when accounts exist, else `"picker"`.
   Test: extend `tests/e2e/onboarding.spec.ts` (or new spec) — connect one account, click
   "Connect another account", assert picker visible + existing account list hidden, then
   cancel and assert the connected summary (with the existing account) is visible again.

2. **One-click Google consent.** Add `openConsentScreen()` + `popupBlocked` state to
   `use-google-connect-flow.ts` (additive; `startAuthorization`/`authUrl` unchanged for
   Settings). Wire `google-connector-step.tsx`'s single always-visible button to it: open
   `about:blank` synchronously on click, navigate the ref on authorize success, close it and
   surface the existing error on failure, show a manual `<a>` fallback + explanatory message
   when the popup was blocked.
   Test: e2e with `page.waitForEvent("popup")` asserting one click navigates to the mock
   `authUrl`; a second case forcing `window.open` to return null (init script) asserting the
   fallback link + message appear; a third forcing the authorize route to 500 and asserting
   the popup is closed and an error is shown.

3. **Equal provider-card hierarchy.** Restructure the picker so every provider (Google + 4
   IMAP) renders through the same full-weight row/card component; retire the dashed
   `.onb-provmini` "More services" secondary treatment for these five. Update
   `onboarding-design.css` / `onboarding-connectors.css` accordingly. Description text keeps
   conveying real capability differences (OAuth vs. app-password) — only visual weight is
   equalized.
   Test: e2e assertion that all 5 provider CTAs share the same container class / are reachable
   in one consistent tab/DOM order (markup parity is the actual mechanism here).

4. **IMAP provider setup steps + verified links.** Extend `IMAP_PROVIDERS` entries with
   `steps: string[]` and `helpUrl`. Render an ordered list (reuse `.onb-guide` list styling)
   plus an `ExternalLink`-icon link under the existing prerequisite sentence in `mode ===
"imap"`. Wire in the four verified URLs above.
   Test: extend the existing Proton e2e case (keep its current assertions passing) and add
   one assertion per remaining provider for steps-list + help link presence.

5. **CSS pass** for the new IMAP steps list + equalized picker layout — onboarding-local files
   only (`onboarding-design.css`, `onboarding-connectors.css`).

6. **Full local gate** before wrap-up: `pnpm --filter @jarv1s/web lint && pnpm --filter
@jarv1s/web typecheck`, then `npx playwright test tests/e2e/onboarding.spec.ts
tests/e2e/connect-google.spec.ts tests/e2e/connect-imap.spec.ts --project=chromium`.
   Record exact commands + exit codes in the wrap-up report.

## Wrap-up override (run-specific, from Coordinator)

Branch is based on live `coord/1179-pdf` staging. Do **not** push or open a PR. Stop after a
clean local commit history (green gate) plus a compact verification report to the Coordinator.
Coordinator integrates for #5178 visual QA and later cuts a clean main-based PR.
