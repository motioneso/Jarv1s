# Relay — JS-06 job-search module surface (FABLE)

Successor: you are FABLE (handoff mandates Fable model), continuing JS-06 via `coordinated-build`.
Task issue #935 (epic #913). Worktree = this one; branch `feat/js-06-module-surface` rooted at
origin/main `9d4589d1` (JS-01..05 included). Read by SECTION only:

- Handoff (bans, risk tier): `docs/coordination/2026-07-11-js-06-build-handoff.md` (read-only, NEVER commit)
- Spec: `docs/superpowers/specs/2026-07-10-job-search-js-06-module-surface.md` (57 lines, safe to read fully)
- Coordinator: label `Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f` (resolve pane fresh by label; exactly one)

## Where the build stands (updated relay 3, 2026-07-11)

Done: orient, spec verification, [DESIGN-FORK] ruling, plan APPROVED, and **plan Tasks 1–5
COMMITTED GREEN** (RED-GREEN-commit each): `5df78462` T1 jsx shim + runtime accessors ·
`27020ca9` T2 api.ts invoke/run-now client · `e76efa8a` T3 store/router/format · `7240aef0` T4
Root shell + authored states + styles + starter drafts · `e7910dcd` T5 Overview screen. Verified:
21/21 unit tests (`tests/unit/job-search-web-core.test.ts` + `tests/unit/job-search-web-screens.test.tsx`)
+ `pnpm check:external-modules` exit 0.

**THE PLAN IS THE SINGLE SOURCE OF TRUTH:**
`docs/superpowers/plans/2026-07-11-js-06-module-surface.md` — 12 tasks, COMPLETE code per task,
exact commands, exact `git add` paths. Read it PER TASK (by section), never front-to-back.
Section offsets: T6@1438 T7@1586 T8@1862 T9@2091 T10@2194 T11@2331 T12@2367 exit-criteria@2389.

NEXT STEP (immediately): **Task 6 — Onboarding screen** (plan line ~1438). RED first (append to
`tests/unit/job-search-web-screens.test.tsx`), then GREEN (replace placeholder
`external-modules/job-search/src/web/screens/onboarding.tsx`), verify
`pnpm vitest run tests/unit/job-search-web-screens.test.tsx tests/unit/job-search-web-core.test.ts && pnpm check:external-modules`
(never trust `| tail` exit codes), commit per plan Task 6 Step 5. Then T7–T12 the same way, →
`coordinated-wrap-up` (PR `Closes #935` + report to Coordinator; Coordinator QAs sensitive-tier:
module-isolation / no-contract-drift / fail-closed-disabled / text-only walk).

Built-so-far map (all under `external-modules/job-search/src/web/`): `runtime.ts` (typed accessors
over frozen host global; exports h/Fragment/hooks/`ReactNodeLike`), `jsx.d.ts` (loose
IntrinsicElements), `api.ts` (`invokeTool` → ToolOutcome ok|blocked|disabled|error, 404→disabled;
`runMonitorNow` → RunNowOutcome, jobId null = already-queued), `store.ts` (`useToolQuery` map cache
+ useSyncExternalStore w/ 3rd arg; `invalidateQueries`, `__resetStoreForTests`), `router.ts`
(MODULE_BASE `/m/job-search`, `useModulePath`, `ModuleLink` w/ `key?` prop), `format.ts`
(STEP_LABELS 6 keys, `onboardingProgress`, `dueLabel`, `whenLabel`), `states.tsx` (5 authored
states + `outcomeGate` ladder — ends `h(Fragment, null, render(...))` because Fragment is typed
unknown; + `announce`/`subscribeLive` live announcer), `styles.ts` (layout-only jsm-* CSS),
`starter-drafts.ts` (`starterDraftForStep`), `root.tsx` (Root, HostActions type, TABS, LiveRegion,
RouteSwitch), `index.ts` (contract v1 default export), `screens/overview.tsx` (real — pure
`OverviewView` + container chaining onboarding.get-state → monitor.list through outcomeGate).
`screens/{onboarding,profile,monitors,opportunities}.tsx` still placeholders. Gotcha: renderToString
inserts `<!-- -->` between adjacent JSX text nodes — build assertable strings as ONE template literal.

## Plan approval — Coordinator flag rulings (binding)

"[PLAN APPROVED — JS-06] Inside the spec + model-C ruling; green to build." Rulings:
(1) local fetch helper OK but SAME-ORIGIN AUTHENTICATED — same base URL + creds as module-web-sdk
`requestJson` (`packages/module-web-sdk/src/index.ts:82`: relative path, `credentials:"include"`,
accept + X-Timezone headers); only divergence = preserving non-2xx bodies (needed for the 403
`confirmation_required` invocation body). Do NOT reinvent auth/base-url. (2) no react-query +
local cache OK. (3) URL-only, NO core nav entry — CONFIRMED correct. (4) wall-clock + IANA zone
label, no tz math OK. **ZERO host code is a hard line — anything tempting a host-code or
packages/shared contract change → STOP + [DESIGN-FORK] (bumps to security tier).** External module
strings TEXT-only + escaped; disabled = fail-closed, no actions.

## Coordinator ruling (model C — binding)

Browser read path EXISTS: `POST /api/ai/assistant-tools/:name/invoke` (`packages/ai/src/routes.ts:577`).
Do NOT build a new endpoint (A rejected); do NOT ship data-less shell (B rejected). Build real Root
under `/m/job-search/*`: (1) reads via invoke route — `job-search.onboarding.get-state` /
`profile.get` / `resume.get` / `monitor.list` / `monitor.get` (all risk:read; also `sources.list`);
(2) run-now via `POST /api/modules/job-search/queues/job-search.monitor-run/run` body
`{jobKind:"job-search.monitor-run-now", params:{monitorId}}` → `202 {jobId}`; second submit →
`jobId:null` = already queued (no polling); (3) module id is `job-search` NOT `jarv1s.job-search`
(spec/handoff stale); (4) JSX OK via esbuild jsxFactory shim off `globalThis.__JARVIS_MODULE_RUNTIME__`
— web bundle stays react-free. SECURITY (do not weaken): only risk:read executes on REST (write
tools 403 `confirmation_required` — Root never calls write tools without confirm flow); dispatch is
`withDataContext(accessContext)`, never actorUserId-from-body; keep sanitize+bound on output; render
external job text as TEXT never raw HTML; run-now params = IDs only. Exit criteria stand — nothing deferred.

## Verified facts (do NOT re-explore)

- Smoke proof: `tests/integration/js06-invoke-smoke.test.ts` — **TEMPORARY, header says DO NOT
  COMMIT** (uncommitted on disk). 3/3 passed: GET `/api/ai/assistant-tools` lists all 16 job-search
  tools; `monitor.list` invoke → 200 `invocation.status:"succeeded"`,
  `result:{status:"ok",monitors:[]}` (all tools have `outputSchema:null` → handler fields pass
  sanitize/bound intact); `monitor.save` → 403 `blockedReason:"confirmation_required"`. Supersede
  with a permanent test in the plan; delete the temp file before any commit sweep.
- Root file to build out: `external-modules/job-search/src/web/index.ts` (JS-01 placeholder,
  hand-rolled createElement off the frozen global `window.__JARVIS_MODULE_RUNTIME__ =
  {contractVersion:1, react, reactDomClient}` — no react-query exposed, so module uses plain
  hooks/tiny fetch cache, not host React Query).
- Host mount: `apps/web/src/app.tsx` — `ExternalModuleMount` inside `AppShell` `<Routes>` at
  `/m/:moduleId/*`; Root gets `hostActions.openAssistant({starterPrompt})` (#916, sanitized ≤1000
  chars, never auto-submits) via `createModuleHostActions`; loader fails closed to `Missing`.
- No react-router exposed to module → Root needs tiny internal router (pushState/popstate) for
  `/m/job-search/{onboarding,profile,monitors,opportunities/{new,saved,passed,stale}}`.
- Build script `scripts/build-external-module.ts`: web build has NO jsx/react-shim and NO
  `@jarv1s/module-web-sdk` alias yet (worker build aliases module-sdk — mirror that pattern).
  Module tsconfig: `external-modules/job-search/tsconfig.json` (strict, bundler resolution, paths
  has module-sdk/worker only); typecheck via root `pnpm check:external-modules`.
- External modules get NO nav entry (`serializeExternalModule` → `navigation: []`,
  `apps/api/src/server.ts:901`) — surface only reachable by URL. Flag nav-entry as explicit plan
  task/scope question for Coordinator.
- Unit render harness = `renderToString` from `react-dom/server` + createElement (see
  `tests/unit/sports-ticker.test.tsx`) — no testing-library in repo.
- E2E: `tests/e2e/mock-modules.ts` `mockExternalWebModule` already fakes a job-search bundle +
  `/api/modules` responses (glob needs trailing `*` for Vite `?import`); used by
  `tests/e2e/external-modules.spec.ts`. Extend to serve the REAL built bundle + mock invoke/run-now
  responses for interaction tests + screenshots.
- Integration harness to clone: `tests/integration/external-module-job-search.test.ts`
  (resetEmptyFoundationDatabase → buildExternalModule → temp modulesDir → createApiServer
  `enableExternalModules` → first-signup admin → enable module). Runner
  `scripts/test-integration.ts` auto-isolates DB.
- Six onboarding checkpoints (STEP_ORDER): resume_intake, resume_critique, resume_approval,
  profile, sources_schedule, review_enable; `step` = first incomplete, "done" when all complete.

## Task ledger (plan doc is authoritative; this is the pointer)

Plan Tasks 1–12: T1–T5 COMMITTED (see "Where the build stands") · **T6 onboarding screen = NEXT** ·
T7 profile & resume (incl. external-text escaping test) · T8 monitors + RunNowButton (queued state,
no polling; Step 6 wires RunNow into Overview) · T9 opportunities shell · T10 permanent
integration test + browser-safety walk extension (**and `rm tests/integration/js06-invoke-smoke.test.ts`
— temp, NEVER commit it**) · T11 e2e · T12 full gate (`pnpm build:external:job-search &&
pnpm verify:foundation`) + pre-push trio + rebase + `coordinated-wrap-up`. Unit harness =
`renderToString` from react-dom/server, runtime-install helper imported FIRST;
`useSyncExternalStore` needs the 3rd getServerSnapshot arg or renderToString throws. JDS: jds-*
primitives only, module `jsm-*` classes layout-only (zero color declarations), no curved
left-border accents, external text as text.

## Bans still in force

Explicit-path `git add` only; never touch `docs/coordination/`, board, merges; caveman comms to
Coordinator, conventional in artifacts; pre-push trio + rebase before every push; relay at 70%
meter as Fable, same worktree.
