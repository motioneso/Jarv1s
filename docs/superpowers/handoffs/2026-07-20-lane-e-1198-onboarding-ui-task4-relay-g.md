# Lane E #1198 onboarding UI — Task 4 relay (g)

Same worktree/branch (`feat/1198-onboarding-ui`), don't create a new one. Supervisor: pane label
`Coord 1193 Supervisor 5` — re-resolve fresh via `herdr pane list`, never reuse a pane_id from any
doc. No push/PR without explicit supervisor grant. DB-less only: no `verify:foundation`, no DB.

Relay (b) (`...-relay-b.md`) still has the full Task 4 assertion list + Task 5 gate command block
— don't re-read design mockup/plan. Relay (f) is superseded by state below.

## State

HEAD `ec1397b8`, clean tree except untracked stale doc (leave alone, not ours):
`docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui.md`.

Commits this run:
- `54da3e34` RED skeleton for `tests/e2e/js1198-job-search-onboarding.spec.ts` (10 tests).
- `8e6b888a` **real bug fix**: `index.tsx` `JobsOnboarding`'s mount-once `subscribeRecords`
  listener stale-closed over `outcome`/`pendingIds` from the initial render (always null), so
  `advanceOnDurableEvent` never ran in the shipped app. Fixed with a ref-latch (refs synced every
  render, effect still subscribes once — supervisor confirmed this exact approach independently).
- `ec1397b8` fixed a wrong test assumption (seed called exactly once — actually 2x, StrictMode
  double-invokes the mount effect in dev, `apps/web/src/main.tsx` wraps in `<StrictMode>`) and
  filled in the executed-advance test (was `test.fixme`) using the 2-wave SSE + call-counted
  invoke-mock recipe.

**6/10 e2e tests green** (`pnpm exec playwright test tests/e2e/js1198-job-search-onboarding.spec.ts --project=chromium`).

## 4 remaining RED — diagnosis, not yet fixed

1. **"denied profile approval retains Dealbreakers control"** (line ~286) and
   2. **"executed action_result advances the phase"** (line ~344): both time out on
   `page.waitForRequest("**/api/chat/turn")` after clicking `"None of these"` / `"Set dealbreakers"`
   — the click never fires a turn POST. Traced to `index.tsx:460-471`
   (`buildProfileSubmit`+`MultiControl`): both the primary CTA and skip button route through the
   same `onSubmit={(values) => submitTurn(buildProfileSubmit(substep, submitValues(values)))}`
   prop on `MultiControl` (`controls.tsx`) — **not yet confirmed** whether `MultiControl`'s skip
   button actually calls `onSubmit([])` or something else (e.g. a separate `onSkip` prop that
   isn't wired here, or a `min` chip-count gate blocking the click). Read `controls.tsx`'s
   `MultiControl` implementation next — grep `skip`/`onSkip`/`cta` there (only `index.tsx`'s call
   site was checked this run, not the component itself).

3. **"boards require valid URL/token"** (line ~434): `Watch these N boards` submit button never
   enables after filling the Greenhouse input. Check `SourcesControl` in `controls.tsx` — my test
   fills `page.getByLabel("Greenhouse board token or URL")`, but that exact accessible name/label
   wiring is unverified (may be a different aria-label, or need a run-time chip selected too, not
   just a query filled — `SourcesControl` copy in the earlier read mentioned `sourceQuery` +
   run-time chips 06:00/07:00/08:00 as both potentially required for `Watch these N boards` to
   enable).

4. **"done Summary + Go to Job Search"** (line ~453): text `/Monitoring on · first run/` not
   found. Check `Summary` component in `controls.tsx` for its actual eyebrow copy — my guess was
   unverified against source this run.

## Next steps

1. Read `external-modules/job-search/src/web/screens/onboarding/controls.tsx` `MultiControl` and
   `SourcesControl` and `Summary` components in full (not yet re-read this run past the earlier
   summary notes) — fix the 4 tests against real prop names/copy.
2. Get all 10 `js1198` tests green, then run all three specs together:
   `pnpm exec playwright test tests/e2e/js1198-job-search-onboarding.spec.ts tests/e2e/js06-module-surface.spec.ts tests/e2e/assistant-surface.spec.ts --project=chromium`
3. **Once fully green**, squash/re-commit the spec file's history under the exact message from
   relay (b) (verbatim, don't paraphrase):
   ```
   test(job-search): cover guided onboarding flow

   User-facing summary: Job Search onboarding now has browser coverage for upload, approvals, denial, recovery, and completion.

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
   (The 3 WIP commits already on branch — `54da3e34`/`8e6b888a`/`ec1397b8` — can stay as-is if
   squashing is awkward; supervisor hasn't ruled on squash-vs-keep, ask if it matters. `8e6b888a`
   is a real app bug fix and should probably stay its own commit regardless.)
4. Run the full Task 5 gate (verbatim in relay (b)), capture every command's exit status — all
   must exit 0, vitest-only is explicitly NOT accepted:
   ```bash
   pnpm build:external:job-search
   pnpm vitest run tests/unit/external-module-job-search-handlers-onboarding.test.ts tests/unit/external-module-job-search-handlers-resume.test.ts tests/unit/external-module-job-search-manifest.test.ts tests/unit/job-search-web-onboarding.test.tsx tests/unit/job-search-web-screens.test.tsx tests/unit/job-search-web-core.test.tsx tests/unit/external-module-job-search-bundle.test.ts
   pnpm exec playwright test tests/e2e/js1198-job-search-onboarding.spec.ts tests/e2e/js06-module-surface.spec.ts tests/e2e/assistant-surface.spec.ts --project=chromium
   pnpm check:design-tokens
   pnpm check:file-size
   pnpm format:check
   pnpm lint
   pnpm typecheck
   ```
5. Re-resolve `Coord 1193 Supervisor 5` fresh via `herdr pane list`, report gate-ready with full
   commit list + command evidence, or report any blocking error verbatim. Supervisor already
   acknowledged the stale-closure fix and executed-advance approach this run (queued message, no
   reply seen yet — check for one on resume).

## Constraints (unchanged, repeat)

DB-less only (no `verify:foundation`, no DB). No push/PR without explicit supervisor grant. Stage
only your own files when committing (never `git add -A` on the shared worktree). Leave the
untracked stale doc `docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui.md` alone.
