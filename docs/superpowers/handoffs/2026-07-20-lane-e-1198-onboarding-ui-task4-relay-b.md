# Lane E #1198 onboarding UI — Task 4 relay (b)

## Scope

- Plan: `docs/superpowers/plans/2026-07-20-job-search-onboarding-ui.md`, Task 4 (lines 419-479)
  and Task 5 Step 2 (lines 496-507). Read by section, not full.
- Spec: `docs/superpowers/specs/2026-07-19-job-search-embedded-onboarding.md` (APPROVED). Names
  `docs/superpowers/design/job-search-onboarding/JobsOnboarding.jsx.txt` (426 lines) as "the
  primary artifact — copy is final."
- Branch/worktree: `feat/1198-onboarding-ui`, same worktree — do not create a new one.
- Supervisor: pane label `Coord 1193 Supervisor 5` — re-resolve fresh via `herdr pane list`
  before ANY escalation, never reuse a pane_id from any doc.
- No commits made this relay (research/verification only). HEAD is still `631e3a25`.

## Supervisor ruling — must follow exactly (received this relay, do not re-litigate)

Independently confirmed: Task 3's 71/71 green was isolated unit tests on pure fns/components,
never composed. `JobsOnboarding` (screens/onboarding/index.tsx:249-282) renders only
`<Surface composer={{placeholder:"Tell us more"}}/>` after bootstrap — no `activeControl`, no
`localRows`. `derivePhase` is called only inside the `subscribeRecords` callback for
`advanceOnDurableEvent` bookkeeping, never in render. Ruled: **(a)** — fold this into Task 4 as
a required **Step 0**, RED-first, within Lane E's existing delegated authority (no plan
amendment needed).

**Scope guardrails (do NOT balloon):**
1. Wire ONLY existing pieces: compute `phase = derivePhase(outcome.data.snapshot)` in render;
   map phase → `activeControl` using the existing `controls.tsx` exports per the plan phase
   table; set `composer.onSubmitText = buildComposerSubmit(phase, handle)` (already exported,
   unused — index.tsx:189-198); render `localRows` from durable transcript/scripted questions
   per the design artifact.
2. Do NOT invent new controls/behaviors beyond plan Task 3 + Task 4 assertions. If wiring
   reveals a genuinely missing control, STOP and flag the supervisor — don't build net-new.
3. RED-first: add the failing composition/e2e assertion before wiring, confirm RED for the
   right reason, then GREEN.

**Four standing directives from the supervisor (all still in force):**
1. Incremental commit: the moment a RED `js1198-job-search-onboarding.spec.ts` skeleton fails
   for the right reason, commit it before deep fixture work. Commit again at green.
2. **Already done this relay** (see below) — js06 first-run test confirmed broken exactly as
   predicted; fixing its assertion to match `JobsOnboarding`'s real first-run render is CORRECT
   per the supervisor (Exit Review plan:529), not a regression to avoid.
3. Do NOT report gate-ready on unit tests alone (already denied once). Gate bar = Task 4 spec
   committed+green AND full Task 5 Step 2 command list, all exit 0.
4. If Playwright genuinely can't run, STOP and report the exact error — confirmed NOT the case
   here (see below), so this shouldn't trigger.

## Verified this relay (do not re-derive)

- Ran `pnpm exec playwright test tests/e2e/js06-module-surface.spec.ts --project=chromium`:
  **8/9 passed, 1 failed exactly as predicted.** Failure at
  `tests/e2e/js06-module-surface.spec.ts:303` —
  `getByRole("heading", { name: "Setting up your job search" })` not found. Actual DOM (from
  `test-results/js06-module-surface-JS-06--0b587-with-the-Lane-E-placeholder-chromium/error-context.md`):
  renders `status: text "Loading", paragraph "Loading job search setup…"` — i.e.
  `JobsOnboarding`'s `LoadingState` (index.tsx:276-278), confirming bootstrap never resolves
  fast enough in the mock (or resolves but still renders nothing more expressive pre-wiring).
  This test (lines 291-305) is the one to update once Step 0 wiring lands — its new assertion
  should match the real composed render (e.g. first scripted row/control visible, no tabs), not
  inventing new UI.
- Read in full this relay: `apps/web/src/chat/use-chat-stream.ts`,
  `external-modules/job-search/src/web/screens/onboarding/controls.tsx`,
  `apps/web/src/chat/assistant-surface/surface.tsx`,
  `external-modules/job-search/src/web/screens/onboarding/index.tsx` (full — see exact code
  below), plan Task 3/4/5 sections, spec excerpts, this handoff's predecessor doc
  (`2026-07-20-lane-e-1198-onboarding-ui-task4-relay.md`, commit `631e3a25`).
- **NOT yet read** (next concrete action):
  `docs/superpowers/design/job-search-onboarding/JobsOnboarding.jsx.txt` (426 lines) — needed
  for verbatim scripted copy (intro/question text per phase, exact phase→control mapping) before
  writing the Step 0 RED assertion and the Task 4 e2e spec's "every scripted question/control in
  order" assertion. Read this FIRST, by section if it's large in practice.
- Also not yet independently verified this relay (predecessor claimed to have read):
  `tests/e2e/assistant-surface.spec.ts` full file (SSE mocking pattern) — re-read if its exact
  mocking helpers are needed for the new spec; predecessor's notes below are trustworthy but
  unverified by me directly.

## Key file state (current, exact — no need to re-read to get these facts)

`external-modules/job-search/src/web/screens/onboarding/index.tsx`:
- `JobsOnboarding` (lines 249-282): bootstraps via `bootstrapOnboarding(props.handle)`,
  subscribes records for `advanceOnDurableEvent` bookkeeping only. Render: `if (!outcome) return
  <LoadingState .../>` then `return <Surface composer={{placeholder:"Tell us more"}}/>` — **no
  phase computation in render, no activeControl, no localRows.** This is the gap to close.
- `buildComposerSubmit(phase, handle)` (lines 189-198) — already exists, unused by render.
- `buildProfileSubmit(phase, values)` (lines 164-177) — already exists, unused by render.
- `AssistantSurfaceViewPropsMirror` (lines 37-49) — the exact `Surface` prop shape:
  `localRows?: {id, role: "assistant"|"user", content: ReactNodeLike}[]`,
  `activeControl?: ReactNodeLike`, `composer?: {placeholder?, onSubmitText?}`, `typing?: boolean`.
- `model.ts` exports used: `derivePhase(snapshot)`, `expectedTools(phase)`,
  `OnboardingPhase = "resume_intake"|"resume_critique"|"resume_approval"|"titles"|"comp"|
  "workmode"|"locations"|"dealbreakers"|"sources_schedule"|"done"`.

`controls.tsx` exports (all unused by current render, all needed for Step 0 wiring):
`ChipToggle`, `AddInput`, `MultiControl({options,initial,inferred,addPlaceholder,cta,skip,min,
onSubmit})`, `ResumeDropzone({showPaste,error,onFile,onPaste})`, `SourcesControl({sources,
initialRunTime,onSubmit}) → SourcesSelection{boards,dueTime}` (filters to
`SOURCE_IDS = {greenhouse,lever,ashby}`), `CritiqueCard({summary,strengths,cautions})`,
`ProfileAside({values})`, `Summary({runTime,onContinue,onReset})`.

Likely phase→control mapping (confirm against design artifact before coding):
`resume_intake→ResumeDropzone`, `resume_critique→CritiqueCard`, `resume_approval→` (approve/deny,
check design artifact for exact control), `titles|comp|workmode|locations|dealbreakers→
MultiControl` (five separate sub-steps, options per phase — check design artifact),
`sources_schedule→SourcesControl`, `done→Summary`.

## Task 4 exact requirements (plan lines 432-447 — unchanged from predecessor's notes)

RED-then-GREEN Playwright spec `tests/e2e/js1198-job-search-onboarding.spec.ts` asserting:
non-done state renders onboarding + no tabs; seed route called once; invalid type />5MiB never
upload; valid PDF/DOCX upload sends attachment id + filename text + control context;
extraction/upload failure re-arms upload AND paste fallback sends manual resume text through the
assistant turn (never a module-web write); every scripted question/control/copy appears in
order; denied profile approval retains Dealbreakers control + retry copy; executed-alone does
not advance until fresh tool state changes; boards require valid URL/token and create one
combined turn with no Workday; done Summary + "Go to Job Search" reloads into final tabs; no a11y
violations in authored controls (grep existing specs for `AxeBuilder` before assuming one needs
adding).

## Task 5 full gate (verbatim, plan lines 496-507 — all must exit 0, vitest-only is NOT accepted)

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

Playwright + chromium confirmed working in this worktree this relay (js06 run above).

## Next concrete steps (in order)

1. Read `docs/superpowers/design/job-search-onboarding/JobsOnboarding.jsx.txt` in full (by
   section if large) — extract verbatim phase→control mapping + scripted copy.
2. Write RED assertion for Step 0 composition (unit test in
   `tests/unit/job-search-web-onboarding.test.tsx` asserting `JobsOnboarding` renders the
   correct `activeControl`/`localRows` for a given phase) — confirm it fails for the right
   reason (missing wiring, not a syntax/import error).
3. Implement Step 0 wiring in `index.tsx`: compute phase in render, map to `activeControl`,
   wire `composer.onSubmitText`, render `localRows`. Guardrail: existing pieces only; flag
   supervisor if a plan-required control is genuinely missing, don't build net-new.
4. Get Step 0 GREEN. Commit (small, focused message).
5. Update `js06-module-surface.spec.ts:291-305` first-run assertion to match the real composed
   render. Commit.
6. Write RED `tests/e2e/js1198-job-search-onboarding.spec.ts` skeleton — **commit as soon as it
   fails for the right reason**, before deep fixture work (directive 1, hard rule this time).
7. Implement fixtures/mocks inline, get all three e2e specs green together
   (js1198 + js06 + assistant-surface). Commit:
   `test(job-search): cover guided onboarding flow` / body `User-facing summary: Job Search
   onboarding now has browser coverage for upload, approvals, denial, recovery, and completion.`
   / `Co-Authored-By: Claude <noreply@anthropic.com>` (plan lines 474-479, exact).
8. Run the full Task 5 gate above, capture every command's exit status as evidence.
9. Re-resolve `Coord 1193 Supervisor 5` fresh via `herdr pane list`, report gate-ready with full
   commit list + command evidence (or report a blocking error verbatim — never skip a check
   silently).

## Hard constraints (repeat, do not drop)

DB-less only: no `verify:foundation`, no DB, no push, no PR without explicit supervisor grant.

## Housekeeping note

An untracked, stale doc `docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui.md`
(no `-task4-relay` suffix, from an earlier Supervisor-3-era planning phase) sits in the tree.
It's superseded by this doc and the Task 3/4 relays already committed. Not yours to clean up
unless the supervisor asks — leave it alone.
