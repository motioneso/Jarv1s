# Relay 3 — #1188 connector onboarding (build agent self-relay)

Context meter hit 70%. Relaying per `coordinated-build` step 3. Tasks 1-3 done and committed.
Tree is clean (no uncommitted files besides `.claude/context-meter.log`, which is not part of
this work).

**Plan (approved, still governs):** `docs/superpowers/plans/2026-07-19-1188-connector-onboarding.md`
— read Tasks 4-6 by section only (lines 72-91), never front-to-back.
**Branch/worktree:** `feedback/1188-connector-onboarding`, this worktree, based on live
`coord/1179-pdf`.
**Coordinator:** label `Coordinator`, session `019f7c33-1d00-76c3-97ae-b637ff77faa9` (re-resolve
pane by label+session, panes reflow).
**Wrap-up override still in force:** do NOT push or open a PR when done. Stop after a clean local
gate-green commit history, message the Coordinator a compact verification report. Coordinator
integrates for #1188 visual QA.

## Done (committed, all green — lint/typecheck/relevant e2e passed before each commit)

- **Task 1** — `561df38e fix(onboarding): add-account picker no longer collapses back to
  connected summary`.
- **Task 2** — `1dced69c feat(onboarding): one-click Google consent popup flow`. Root-caused and
  fixed the previously-flaky 3rd test: `popup.waitForEvent("close")` timed out because the mock
  500 resolves fast enough that the popup can already be closed by the time the listener attaches
  — fixed by checking `popup.isClosed()` first (`tests/e2e/onboarding.spec.ts` ~line 389). This
  pattern is reusable — apply it anywhere else a test waits on a popup `close` event after a fast
  mock response.
- **Task 3** — `bce03ff8 feat(onboarding): equal visual weight for Google and IMAP provider
  cards`. Retired `.onb-provmini`/`.onb-provgrid`/`.onb-provsec` usage **only inside
  `google-connector-step.tsx`** — Google + the 4 IMAP providers now render through one shared
  `.onb-prov` full-weight card, one flat list. **Left the `.onb-provmini`/`.onb-provgrid` CSS
  rules themselves untouched** in `onboarding-design.css`/`onboarding-connectors.css` — they are
  still used by the separate Settings picker (`apps/web/src/settings/settings-imap-connect.tsx`,
  covered by `tests/e2e/connect-imap.spec.ts`), which is out of scope for this spec. Verified
  `connect-google.spec.ts` + `connect-imap.spec.ts` (4 tests) still pass unmodified.

## Known pre-existing, out-of-scope failures (do not chase, confirmed still present after Task 3)

Two unrelated wizard-loop tests fail identically with or without this branch's changes (verified
via `git stash` A/B before this work started): `"bootstrap owner with incomplete onboarding..."`
and `"onboarding finish settings destination reaches Settings"`, both timing out on a
`while (continueButton.isVisible()) click()` loop never reaching "Open today's brief" / "Go to
settings". Not in the plan's "must keep passing" list. Report as known pre-existing in the final
wrap-up.

## Next concrete steps (plan lines 72-91)

1. **Task 4 — IMAP provider setup steps + verified links** (plan section 4, line 72). Extend
   `IMAP_PROVIDERS` in `google-connector-step.tsx` (currently `id`/`name`/`tile`/`prerequisite`)
   with `steps: string[]` and `helpUrl`. Render an ordered list (reuse `.onb-guide` list styling —
   see the Google `mode === "connecting"` block's `<ol className="onb-guide">` ~line 176 for the
   exact pattern to mirror) plus an `ExternalLink`-icon link, placed under the existing
   prerequisite sentence in the `mode === "imap"` block (~line 346-437). Keep the existing Proton
   prerequisite sentence and "Passwords are encrypted..." hint text passing unmodified — add
   steps/link below, don't replace. Four verified URLs are in the plan file itself — read plan
   section 4 for the exact Yahoo/Proton/iCloud/Fastmail URLs and step text, don't invent your own.
   TDD: extend the existing Proton e2e case in `tests/e2e/onboarding.spec.ts` (~line 205, the
   `for (const provider of [...])` loop plus the dedicated Proton assertion ~line 214) — keep its
   current assertions passing, add one assertion per remaining provider for steps-list + help-link
   presence.
2. **Task 5 — CSS pass** (plan line 79): onboarding-local files only —
   `apps/web/src/styles/onboarding-design.css` / `apps/web/src/styles/onboarding-connectors.css`.
   For the new IMAP steps list + confirm the equalized `.onb-prov` picker layout reads well with 5
   stacked full-weight cards (no wrapper div was added in Task 3 — cards rely on `.onb-prov`'s own
   `margin-top: 0.75rem` for stacking; sanity check that still looks right, adjust if needed).
   **File-size gate**: `check:file-size` caps all source incl. CSS at 1000 lines — split by
   section if a file would exceed it (see CLAUDE.md `file-size-gate`).
3. **Task 6 — Full local gate** (plan line 82) before wrap-up:
   `pnpm --filter @jarv1s/web lint && pnpm --filter @jarv1s/web typecheck`, then
   `npx playwright test tests/e2e/onboarding.spec.ts tests/e2e/connect-google.spec.ts tests/e2e/connect-imap.spec.ts --project=chromium`.
   Record exact commands + exit codes in the wrap-up report to the Coordinator. Expect the 2 known
   pre-existing failures above; everything else should be green.
4. **Wrap-up**: per the override at plan line 87-91 and the original coordinator instruction — do
   **NOT** push or open a PR. Stop after a clean local gate-green commit history (one commit per
   task, already true for Tasks 1-3) and send the Coordinator (label `Coordinator`, session
   `019f7c33-1d00-76c3-97ae-b637ff77faa9`) a compact report: commits made, gate command + exit
   codes, the 2 known pre-existing failures, and confirmation the tree is clean.

## Self-monitor reminder

Relay again immediately on the next 70% context-meter warning or compaction summary — don't wait
to finish all remaining tasks in one session. You have a fresh full budget now: build first,
relay only after real work past ~80%.
