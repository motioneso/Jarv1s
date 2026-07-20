# Lane E #1198 onboarding UI — Task 4 relay (d)

Same worktree/branch (`feat/1198-onboarding-ui`), do not create a new one. Supervisor: pane label
`Coord 1193 Supervisor 5` — re-resolve fresh via `herdr pane list`, never reuse a pane_id from any
doc. No push/PR without explicit supervisor grant. DB-less only: no `verify:foundation`, no DB.

Full Task 4 assertion list + Task 5 gate command block: read relay (b)
(`docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui-task4-relay-b.md`) — still
authoritative, don't re-read design mockup/plan.

## State

HEAD `f636ebab` — Step 0 wiring (phase→activeControl/localRows/composer composition) implemented
and committed GREEN. Composition test in `tests/unit/job-search-web-onboarding.test.tsx` (describe
"Job Search onboarding composition (#1198 Task 4 Step 0)") passes. `pnpm typecheck`, `pnpm lint`,
`pnpm format:check` all clean on `index.tsx` as of this commit. Tree is clean except the untracked
pre-existing stale doc `docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui.md` (leave
alone, not ours) and `.claude/context-meter.log` (tooling artifact, ignore).

## Next: relay (b) Step 5 — fix stale js06 first-run assertion (IN PROGRESS, no edits made yet)

Target: `tests/e2e/js06-module-surface.spec.ts` lines 291-303, test `"first-run state still
replaces every tab with the Lane E placeholder"`. Confirmed via reading `root.tsx` in full: with a
real `assistantSurface` handle (as e2e provides), `RootView` always renders `<JobsOnboarding
handle={...}/>` when `onboardingStep !== "done"` — `FailClosedFirstRun()`'s "Setting up your job
search" heading is a dead branch here (only fires when `assistantSurface` is `undefined`). The old
assertion is definitively stale; a prior relay confirmed via actual Playwright run that this test
currently fails at line 303 with the DOM showing `LoadingState` only (pre-Step-0-wiring). It has
**not been re-run since `f636ebab` landed** — do that first.

**First concrete action:** run
`pnpm exec playwright test tests/e2e/js06-module-surface.spec.ts --project=chromium` and read the
actual resulting DOM (error-context.md snapshot on failure, or just observe pass/fail) rather than
predicting it. Do not trust the derivePhase calculation below without confirming against the real
render.

**Open question flagged, re-verify before writing the new assertion:** this test's fixtures merge
`defaultFixtures` (`profile`, `resume`, `sources` — read in full already, see below) with a
per-test override of only `onboarding.get-state` → `{step:"profile", completed:{resume_intake:true,
resume_critique:true, resume_approval:true}, gates:{resumeApproved:true, profileApproved:false,
monitorEnabled:false}}`. The `profile` fixture's `active.fields` already has ALL five profile
substep fields populated (`targetTitles`, `compensation`, `remotePreference`, `locations`,
`dealbreakers`). `model.ts`'s `derivePhase` computes profile substep completion from
`toProfileProgress(profile fields)`, and its profile-phase fallback is:
`PROFILE_ORDER.find((phase) => !completed.has(phase)) ?? "dealbreakers"`. Since every field is
already populated, `completed` likely covers all 5 substeps, meaning `derivePhase` may resolve to
`"dealbreakers"` (the `??` fallback), NOT `"titles"` as a naive read might suggest. **Do not guess
— read `model.ts`'s exact `toProfileProgress`/`derivePhase` logic and/or just run the test and read
the actual rendered `activeControl`/`localRows` to confirm which phase this fixture combination
actually resolves to**, then write the new assertion against that real phase's scripted copy/control
(e.g. if `dealbreakers`, assert the Dealbreakers `MultiControl` + its copy row is visible; keep the
existing `navigation` role-count-0 assertion for "no tabs").

**Separate mismatch flagged, check if it matters for this test:** the e2e `resume` fixture (in
`js06-module-surface.spec.ts`, part of `defaultFixtures`) has `evidence: [{claim: "Design system
ownership"}]` — key is `claim`, not `claimText`. `index.tsx`'s new `ResumeReadResult`/`CritiqueCard`
wiring reads `evidence.claimText` (per relay (c)'s spec, `resume.evidence.map(e => e.claimText)`).
If the resolved phase for this test is `>= resume_approval` in `PHASE_ORDER`, `buildLocalRows` will
render the `CritiqueCard` row and `strengths` will be `[undefined]` instead of `["Design system
ownership"]` — cosmetic-only (doesn't crash), but worth a quick look: either fix the fixture
(`claim`→`claimText`) since it's a same-file local fixture object you're free to edit for this test,
or leave it if the new assertion doesn't depend on `CritiqueCard` content. Judgment call, not a
blocker — note whichever way you go in the eventual gate-ready report.

Once the new assertion is written and confirmed GREEN via an actual Playwright run, commit small
(e.g. `test(job-search): fix stale js06 first-run assertion for composed onboarding render`).

## Then: relay (b) steps 6-9 (unchanged, not yet started)

6. Write RED `tests/e2e/js1198-job-search-onboarding.spec.ts` skeleton per relay (b)'s exact
   requirements list (non-done state renders onboarding + no tabs; seed route called once; invalid
   type/>5MiB never upload; valid PDF/DOCX upload sends attachment id + filename text + control
   context; extraction/upload failure re-arms upload AND paste fallback sends manual resume text
   through the assistant turn — never a module-web write; every scripted question/control/copy
   appears in order; denied profile approval retains Dealbreakers control + retry copy;
   executed-alone does not advance until fresh tool state changes; boards require valid URL/token
   and create one combined turn with no Workday; done Summary + "Go to Job Search" reloads into
   final tabs; no a11y violations in authored controls — grep existing specs for `AxeBuilder`
   before assuming one needs adding). **Commit the moment it's RED for the right reason**, before
   deep fixture work — hard supervisor directive, repeated twice in relay (b).
7. Implement fixtures/mocks inline, get all three e2e specs green together (`js1198` + `js06` +
   `assistant-surface`). Commit with the EXACT message from relay (b):
   ```
   test(job-search): cover guided onboarding flow

   User-facing summary: Job Search onboarding now has browser coverage for upload, approvals, denial, recovery, and completion.

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
8. Run the full Task 5 gate (verbatim block in relay (b), also reproduced here):
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
   All must exit 0 — vitest-only is explicitly NOT accepted as gate-ready evidence (denied once
   already this run).
9. Re-resolve `Coord 1193 Supervisor 5` fresh via `herdr pane list` (never reuse a stored
   pane_id), report gate-ready with full commit list + command evidence — including the
   `resume_approval` plain-buttons judgment call (relay (c)) and whichever call you made on the
   `claim`/`claimText` fixture mismatch above — or report any blocking error verbatim, never skip
   a check silently.

## Constraints (unchanged, repeat)

DB-less only (no `verify:foundation`, no DB). No push/PR without explicit supervisor grant. Stage
only your own files when committing (never `git add -A` on the shared worktree). Leave the
untracked stale doc `docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui.md` alone —
not superseded by us, not ours to clean up.
