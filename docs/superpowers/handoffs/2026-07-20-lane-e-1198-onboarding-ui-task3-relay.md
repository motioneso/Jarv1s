# Lane E #1198 onboarding UI — Task 3 relay

## Scope

- Approved plan: `docs/superpowers/plans/2026-07-20-job-search-onboarding-ui.md`
- Branch: `feat/1198-onboarding-ui`
- Worktree: `~/Jarv1s/.claude/worktrees/lane-e-1198`
- Active supervisor: pane label `Coord 1193 Supervisor 5` (session `6bd23f4c`) — re-resolve
  by label via `herdr pane list` before any escalation; do not reuse this session id if it
  has since rotated.
- Risk/verification: DB-less only. Do not run `verify:foundation`, create a DB, push, or open
  a PR without explicit supervisor grant.

## Completed

- Task 1 green commit: `5e16e2da` (`feat(job-search): add onboarding reset and resume import`).
- Task 2 green commit: `455fdc43` (`feat(job-search): add onboarding phase model and controls`).
  Fixed during GREEN: `ChipToggle` inferred-badge condition, malformed `useState<Readonly<...>>`
  generic syntax in `SourcesControl`, three SSR hydration-comment text splits (template-literal
  fix), and two `key?: string` prop-type additions for custom JSX factory compat. All DB-less
  checks clean (vitest 10/10, typecheck, lint, design-tokens, file-size).
- Previous relay doc `docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui-relay.md`
  is now historical (Task 2 finished) — this doc supersedes it for Task 3+.

## Not started: Task 3

No Task 3 files exist yet. Read plan lines 297-418 (`### Task 3: Assistant Surface orchestration
and root first-run gate`) in full before writing code — summary below is not a substitute.

**Files:** create `external-modules/job-search/src/web/screens/onboarding/index.tsx`; modify
`external-modules/job-search/src/web/root.tsx`, `tests/unit/job-search-web-onboarding.test.tsx`,
`tests/unit/job-search-web-screens.test.tsx`.

**Already researched (reread only if stale):**

- `apps/web/src/chat/assistant-surface/contracts.ts` — `AssistantSurfaceHandleV1` shape (`Surface`
  component, `seedOnboarding()`, `submitTurn()`, `uploadAttachment()`, `subscribeRecords()`).
  Module isolation forbids importing this directly — Task 3 declares a **structural local mirror**
  type inside the job-search module instead.
- `apps/web/src/external-modules/loader.ts` — confirms `ExternalWebContributionProps` already
  threads `assistantSurface?: AssistantSurfaceHandleV1` to the module `Root`; no host change needed.
- `external-modules/job-search/src/web/root.tsx` — current state has no `assistantSurface` prop;
  `RootView`'s first-run branch renders a generic `FirstRunPlaceholder`. Needs: optional
  `assistantSurface` prop threaded `Root`→`RootView`; render `JobsOnboarding` when handle present
  and `onboardingStep !== "done"`, else a fail-closed card (never silently proceed without a handle).
- `external-modules/job-search/src/web/screens/profile.tsx` — reference pattern: pure `*View`
  function + container using `useToolQuery`/`outcomeGate`. Follow this split for `JobsOnboarding`.
- `external-modules/job-search/src/web/states.tsx` — shared Loading/Empty/Error/Disabled/Degraded
  components and `outcomeGate` — reuse, don't reinvent.
- Task 2's `screens/onboarding/model.ts` (`derivePhase`, `expectedTools`, `PROFILE_ORDER`, etc.)
  and `controls.tsx` (`ChipToggle`, `MultiControl`, `ResumeDropzone`, `SourcesControl`,
  `CritiqueCard`, `ProfileAside`, `Summary`) are done and stable — consume as-is.

**Plan Steps 1-6 (verbatim from plan, do not re-derive):**

1. Write failing tests in both onboarding test files: fake structural handle asserting
   `seedOnboarding` called once; `submitTurn` called with
   `{text: "Staff Product Designer · Principal Designer", controlContext: {step: "profile",
   action: "titles", values: {targetTitles: [...]}}}`; free-text composer returns `"handled"`;
   root passes handle during first run, omits final tabs, renders fail-closed card when absent.
2. Run `pnpm vitest run tests/unit/job-search-web-onboarding.test.tsx
   tests/unit/job-search-web-screens.test.tsx` — expect FAIL (RED), confirming absence.
3. Implement seed/read/subscribe/submit lifecycle: on mount, `seedOnboarding()` +
   `Promise.all` of `invokeTool` reads for onboarding state, profile, resume, monitors, sources
   (exact tool names in plan). Explicit loading/error/older-host states. Composer submits always
   go through `submitTurn` carrying current control context.
4. Implement durable event advancement: subscribe once; track pending action-request IDs whose
   `toolName` is in `expectedTools(activePhase)`; on matching `action_result` with
   `outcome === "executed"`, re-read snapshot and re-derive phase; denied/error retains control +
   appends retry row; ignore unmatched/`allowed`; serialize polls against races.
5. Implement upload (validate client-side, `uploadAttachment`, submit filename + `attachmentIds`
   + `{step: "resume_intake", action: "import_resume", values: {attachmentId}}`, never read file
   body), profile-field batching after dealbreakers, source/monitor batching with board
   token/URL + timezone + `HH:MM`, and Summary's continue/reset actions (reset submits only
   `onboarding.reset`).
6. Run `pnpm build:external:job-search` + `pnpm vitest run tests/unit/job-search-web-core.test.tsx
   tests/unit/external-module-job-search-bundle.test.ts` (expect PASS, no core-internal imports),
   then stage exactly the 4 Task 3 files and commit:
   `feat(job-search): embed guided onboarding conversation`.

## Known gotchas from Task 2 (will likely recur in Task 3)

- Custom JSX factory (`h` in `runtime.ts`) does not special-case `key` — any component used with
  `key={...}` in a list needs `readonly key?: string` in its own prop type.
- `renderToString` inserts `<!-- -->` between adjacent JSX text/expression siblings — combine into
  one template-literal expression instead of adjacent `{a}{b}` children.
- Run `pnpm run check:external-modules` (not bare `pnpm check:external-modules` from repo root).

## Remaining work after Task 3

- Task 4 (plan ~line 419): "Mocked full-flow browser coverage" — not yet read in detail, read
  by section when reached.
- Task 5 (plan ~line 481): "DB-less lane gate and supervisor handoff" — includes sending the
  gate-ready report to the supervisor pane (resolve fresh by label via `herdr pane list`; halt if
  0 or >1 match) and the hard stop before push/PR without explicit grant.

## Relay reason

Context-meter hit 73%, past the coordinated-build 70% relay trigger, immediately after a
compaction summary appeared. No Task 3 code was written (RED tests not yet started), so there is
nothing uncommitted to carry over — the successor's first action is Step 1 above.
