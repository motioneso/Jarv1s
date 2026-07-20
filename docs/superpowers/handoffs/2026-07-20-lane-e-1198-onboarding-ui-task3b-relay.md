# Lane E #1198 onboarding UI — Task 3 relay (b)

## Scope

- Approved plan: `docs/superpowers/plans/2026-07-20-job-search-onboarding-ui.md`, lines 297-418
  (`### Task 3: Assistant Surface orchestration and root first-run gate`). Read that range only.
- Branch/worktree: `feat/1198-onboarding-ui`, same worktree — do not create a new one.
- Supervisor: pane label `Coord 1193 Supervisor 5` — re-resolve fresh via `herdr pane list`
  before ANY escalation or gate-ready report. Never push/PR without explicit supervisor grant.
- Predecessor doc `2026-07-20-lane-e-1198-onboarding-ui-task3-relay.md` is superseded by this one
  (same relay: hit context-meter 74% + saw a compaction summary, zero Task 3 code written again —
  both relays were pure research/design, no code. **Third session: stop reading, start writing.**).

## Completed (unchanged)

- Task 1 `5e16e2da`, Task 2 `455fdc43` — done, stable, do not touch.
- Task 3: **zero code written**. Files to create/modify: create
  `external-modules/job-search/src/web/screens/onboarding/index.tsx`; modify
  `external-modules/job-search/src/web/root.tsx`, `tests/unit/job-search-web-onboarding.test.tsx`,
  `tests/unit/job-search-web-screens.test.tsx`.

## Design decisions resolved this session (do not re-derive)

**Testing architecture problem SOLVED:** repo Vitest has no jsdom/testing-library
(`vitest.config.ts`, default Node env), and `renderToString` (SSR) never fires `useEffect`. Grepped
all `tests/unit/job-search*.test.tsx` for `vi.mock`/`vi.fn` — **zero module mocks used anywhere**.
The one network-backed test file (`job-search-web-core.test.tsx`) stubs the **global `fetch`**
directly (`stubFetch` helper), because `api.ts#invokeTool` calls `fetch(...)` at module scope, not
through an injectable client. **Resolution: `index.tsx` must expose plain exported functions
decoupled from React's render/effect cycle**, testable by direct call or by stubbing
`globalThis.fetch` the same way `job-search-web-core.test.tsx` already does — not by mounting +
firing DOM events, not by `vi.mock`.

**Concrete exported shape for `index.tsx`** (co-design with RED tests, adjust if a test forces a
different signature, but start here):

- Structural mirror types (module isolation — do NOT import `apps/web/src/chat/assistant-surface/contracts.ts`):
  `AssistantSurfaceHandleMirror` (`Surface`, `seedOnboarding()`, `submitTurn()`, `uploadAttachment()`,
  `subscribeRecords()`) and `AssistantRecordMirror` (discriminated on `kind`: `"action_request"`
  with `id`/`toolName`; `"action_result"` with `actionRequestId`/`outcome`). Match
  `AssistantSurfaceHandleV1` field-for-field (already read in full this session — shape is settled).
- `bootstrapOnboarding(handle): Promise<...>` — calls `handle.seedOnboarding()` once, then the
  `Promise.all` of `invokeTool` reads. **Exact tool names + response shape for this Promise.all are
  in plan Step 3 (~line 330-370) — reread verbatim, do not guess; not captured in this doc.**
  Returns a tagged loading/ok/error/disabled result (mirror `ToolOutcome` pattern from `api.ts`).
- `buildProfileSubmit(phase: ProfileSubstep, values): {text: string; controlContext: object}` —
  pure mapping fn for the exact `{text, controlContext: {step:"profile", action, values}}` shape
  the plan's RED test asserts (see plan Step 1 snippet, already quoted in prior handoff: titles
  example is `text: "Staff Product Designer · Principal Designer"`, `controlContext.action:
  "titles"`). This pure fn is what the RED test calls directly + asserts against; a thin wiring
  callback then does `handle.submitTurn(buildProfileSubmit(...))`.
- `buildComposerSubmit(phase, handle): (text: string) => "handled"` — free-text composer handler;
  builds `{step, action: "freeform"}` (or similar — confirm against plan) controlContext, calls
  `handle.submitTurn(...)` (fire-and-forget is fine, composer contract is synchronous return), always
  returns `"handled"`.
- `advanceOnDurableEvent(records, pendingIds, activePhase, onAdvance)` — pure reducer per plan Step
  4: track `action_request` ids whose `toolName` in `expectedTools(activePhase)`; on matching
  `action_result` with `outcome === "executed"`, call `onAdvance()` (re-read + re-derive); denied/
  error → return a retry-row marker; ignore unmatched/`allowed`.
- `JobsOnboarding(props: {handle: AssistantSurfaceHandleMirror})` — the actual component: wires the
  above via `useEffect`(bootstrap once) + `useState` + `handle.subscribeRecords`. Not meaningfully
  testable via `renderToString` (no effects) — cover it with ONE structural smoke test (initial
  loading `activeControl` renders) and put all real behavior coverage on the pure functions above.

**`root.tsx` change:** thread optional `assistantSurface?: AssistantSurfaceHandleMirror` prop
`Root` → `RootView`. When `onboardingStep !== "done"`: render `JobsOnboarding` if handle present,
else a fail-closed card (new, not `FirstRunPlaceholder` — never silently proceed without a handle).
Root test: fake handle object, assert `JobsOnboarding`'s marker renders when handle passed and
final tabs are omitted; assert fail-closed card renders (and no tab nav) when handle is `undefined`.

## Plan Steps 1-6 (verbatim reference, unchanged from prior doc — see plan file, not re-copied here
to save space; read plan lines 297-418 directly)

## Next concrete action

1. Reread plan lines 297-418 (Step 1 and Step 3's exact `Promise.all` tool-name list — the only
   piece not settled above).
2. Write RED tests in both test files using the exported shape above + a fake
   `AssistantSurfaceHandleMirror` (vi.fn() for `seedOnboarding`/`submitTurn`/`subscribeRecords`) —
   this repo's tests DO use `vi.fn()` for plain callback stubs (not `vi.mock`), confirmed fine.
3. Run `pnpm vitest run tests/unit/job-search-web-onboarding.test.tsx tests/unit/job-search-web-screens.test.tsx`,
   confirm RED for the right reason (missing exports).
4. Implement per Steps 3-5, GREEN the tests.
5. `pnpm build:external:job-search` + `pnpm vitest run tests/unit/job-search-web-core.test.tsx tests/unit/external-module-job-search-bundle.test.ts`,
   then stage exactly the 4 Task 3 files, commit: `feat(job-search): embed guided onboarding conversation`.
6. Self-monitor context; relay again on 70% meter warning or compaction-summary sighting — but
   **only after committing real code this time**, not another research-only pass.

## Known gotchas from Task 2 (will recur)

- Custom `h` (runtime.ts) doesn't special-case `key` — any component used with `key={...}` needs
  `readonly key?: string` in its own prop type.
- `renderToString` inserts `<!-- -->` between adjacent JSX text/expression siblings — combine
  `{a}{b}` into one template-literal expression.
- Run `pnpm run check:external-modules` (not bare `pnpm check:external-modules`).

## Remaining after Task 3

- Task 4 (plan ~line 419, "Mocked full-flow browser coverage") and Task 5 (plan ~line 481,
  "DB-less lane gate and supervisor handoff" — includes the gate-ready report to the supervisor
  pane, resolved fresh by label; halt if 0 or >1 match). Not read yet — read by section when
  reached.

## Hard constraints (repeat, do not drop)

DB-less only: no `verify:foundation`, no DB, no push, no PR without explicit supervisor grant.
