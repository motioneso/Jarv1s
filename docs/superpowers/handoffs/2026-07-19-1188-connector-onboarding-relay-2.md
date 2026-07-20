# Relay 2 — #1188 connector onboarding (build agent self-relay)

Context meter hit 73%. Relaying per `coordinated-build` step 3 / user's explicit mid-turn
instruction. Task 1 committed; Task 2 in-flight, 2/3 new tests green, 1 flaky/failing.

**Plan (approved, still governs):** `docs/superpowers/plans/2026-07-19-1188-connector-onboarding.md`
**Branch/worktree:** `feedback/1188-connector-onboarding`, this worktree, based on live
`coord/1179-pdf`.
**Coordinator:** label `Coordinator`, session `019f7c33-1d00-76c3-97ae-b637ff77faa9` (re-resolve
pane by label+session, panes reflow).
**Wrap-up override still in force:** do NOT push or open a PR when done. Stop after a clean local
gate-green commit history, message the Coordinator a compact verification report. Coordinator
integrates for #5178 visual QA.

## Done (committed)

- **Task 1** — `561df38e fix(onboarding): add-account picker no longer collapses back to
  connected summary`. Green, e2e passing, lint/typecheck not yet re-run since (do so as part of
  Task 2's commit).

## In flight (UNCOMMITTED — do not lose these 3 files)

- `apps/web/src/connectors/use-google-connect-flow.ts` — additive hook changes:
  `openConsentScreen()`, `popupBlocked` state, `consentPopupRef`. `startAuthorization`/`authUrl`
  untouched (Settings-safe). Logic looks correct: opens `about:blank` synchronously in the click
  handler, navigates the ref on `authorizeMutation.onSuccess`, closes it + clears the ref on
  `onError`.
- `apps/web/src/onboarding/google-connector-step.tsx` — replaced the two-click consent block with
  one always-visible "Open consent screen" button wired to `google.openConsentScreen`, a
  conditional blocked-popup fallback `<a>` link, and a conditional hint. The subsequent "Finish
  the connection" redirect-paste block is unchanged.
- `tests/e2e/onboarding.spec.ts` — 3 new tests appended after the Task 1 test (~line 272 on):
  1. `"one-click Google consent opens the popup on the first click"` — **PASSING**.
  2. `"blocked popup shows a manual link and explanation"` — **PASSING**.
  3. `"failed authorization closes the popup and surfaces the error"` (~line 348) — **FAILING**,
     30s timeout on `await popup.waitForEvent("close")`. Not yet root-caused. Also fixed a
     pre-existing locator bug in all 3 new tests: `getByLabel("Client ID")` / `getByLabel("Client
     secret")` needed `{ exact: true }` — without it, Playwright substring-matches into the
     "Upload credentials JSON... we will extract the client ID and client secret automatically"
     helper text on the file-upload `<label>`, causing a strict-mode 2-element resolution. This
     class of bug is in memory as `uat-spec-gotchas` — apply `{ exact: true }` proactively on any
     future `getByLabel` calls in this file.

## Next concrete steps

1. Debug test 3 (`failed authorization closes the popup and surfaces the error`,
   `tests/e2e/onboarding.spec.ts` ~line 348). The test overrides
   `**/api/connectors/google/authorize` to return 500 via `page.route(...)` registered AFTER
   `mockApi(page, ...)` — that should win per "last registered route wins," so the override itself
   is probably fine. Suspect the popup-close signal: `popup.waitForEvent("close")` may never fire
   if `consentPopupRef.current` is stale/null by the time `onError` runs, or if the mutation's
   `onError` callback isn't actually being invoked (e.g. TanStack Query swallowing/retrying on
   500, or the mock response shape not matching what `authorizeGoogleConnection`/`requestJson`
   expects for error parsing). Get a trace: `npx playwright test tests/e2e/onboarding.spec.ts -g
   "failed authorization" --project=chromium --trace on`, then
   `npx playwright show-trace test-results/.../trace.zip`, or just add a temporary
   `page.on("console", ...)` / check `authorizeMutation.isError` state in devtools. Also sanity-
   check whether `useMutation` retries on error by default (TanStack Query default `retry: 3` for
   queries but mutations default to `retry: 0` — verify no custom retry config exists upstream).
2. Once test 3 is green: `pnpm --filter @jarv1s/web lint && pnpm --filter @jarv1s/web typecheck`,
   then stage explicit paths (`apps/web/src/connectors/use-google-connect-flow.ts`,
   `apps/web/src/onboarding/google-connector-step.tsx`, `tests/e2e/onboarding.spec.ts`) and commit
   Task 2 with a conventional message + `Co-Authored-By: Claude <noreply@anthropic.com>` trailer.
3. Task 3 — Equal provider-card hierarchy (plan section 3): retire `.onb-provmini` dashed
   secondary treatment; make Google + 4 IMAP providers share one full-weight card component;
   update `onboarding-design.css` / `onboarding-connectors.css`.
4. Task 4 — IMAP provider setup steps + verified links (plan section 4): extend `IMAP_PROVIDERS`
   with `steps: string[]` + `helpUrl`; four verified URLs are in the plan file (Yahoo/Proton/
   iCloud/Fastmail). Keep the existing Proton prerequisite sentence + "Passwords are encrypted..."
   hint text passing unmodified — add steps/link below it, don't replace it.
5. Task 5 — CSS pass, onboarding-local files only.
6. Task 6 — Full local gate: `pnpm --filter @jarv1s/web lint && pnpm --filter @jarv1s/web
   typecheck`, then `npx playwright test tests/e2e/onboarding.spec.ts tests/e2e/connect-google.spec.ts
   tests/e2e/connect-imap.spec.ts --project=chromium`. Record exact commands + exit codes.

## Known pre-existing, out-of-scope failures (do not chase)

Two unrelated wizard-loop tests were already failing before this work started (verified via
`git stash` A/B on just `google-connector-step.tsx` — identical failure with the file
unmodified): `"bootstrap owner with incomplete onboarding..."` and `"onboarding finish settings
destination reaches Settings"`, both timing out on a `while (continueButton.isVisible()) click()`
loop never reaching "Open today's brief" / "Go to settings". Not in the plan's "must keep passing"
list. Report as known pre-existing in the final wrap-up, don't fix.

## Self-monitor reminder

Relay again immediately on the next 70% context-meter warning or compaction summary — don't wait
to finish all remaining tasks in one session.
