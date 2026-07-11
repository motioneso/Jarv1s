# Relay — JS-06 job-search module surface (FABLE)

Successor: you are FABLE (handoff mandates Fable model), continuing JS-06 via `coordinated-build`.
Task issue #935 (epic #913). Worktree = this one; branch `feat/js-06-module-surface` rooted at
origin/main `9d4589d1` (JS-01..05 included). Read by SECTION only:

- Handoff (bans, risk tier): `docs/coordination/2026-07-11-js-06-build-handoff.md` (read-only, NEVER commit)
- Spec: `docs/superpowers/specs/2026-07-10-job-search-js-06-module-surface.md` (57 lines, safe to read fully)
- Coordinator: label `Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f` (resolve pane fresh by label; exactly one)

## Where the build stands (updated relay 4, 2026-07-11)

**Plan Tasks 1–9 COMMITTED GREEN** (RED-GREEN-commit each): `5df78462` T1 jsx shim + runtime ·
`27020ca9` T2 api.ts client · `e76efa8a` T3 store/router/format · `7240aef0` T4 Root shell +
states + starter drafts · `e7910dcd` T5 Overview · `e8a0ac66` T6 Onboarding · `931ba104` T7
Profile & resume · `09564dc6` T8 Monitors + RunNowButton · `84a8cac1` T9 Opportunities shell.
Verified at T9: **31/31 unit tests** (`tests/unit/job-search-web-core.test.ts` +
`tests/unit/job-search-web-screens.test.tsx`) + `pnpm check:external-modules` exit 0. All five
screens under `external-modules/job-search/src/web/screens/` are now real (no placeholders left).
T8's optional Overview mod was SKIPPED per plan (overview.tsx already had the /monitors link).

**THE PLAN IS THE SINGLE SOURCE OF TRUTH:**
`docs/superpowers/plans/2026-07-11-js-06-module-surface.md` — read PER TASK (by section), never
front-to-back. Section offsets: T10@2194 T11@2331 T12@2367 exit-criteria@2389.

NEXT STEP (immediately): **Task 10 — permanent integration test + browser-safety walk** (plan line
~2194). Exploration is DONE (see verified facts below) — write the test directly. Create
`tests/integration/js06-module-surface.test.ts` (clone harness from
`tests/integration/external-module-job-search.test.ts`), 5 tests: (1) GET `/api/ai/assistant-tools`
filtered `t.moduleId === "job-search"` lists the 6 read tools; (2) `monitor.list` invoke → 200
`invocation` matchObject `{status:"succeeded", blockedReason:null, result:{status:"ok",monitors:[]}}`;
(3) `monitor.save` invoke → 403 `{status:"blocked", blockedReason:"confirmation_required"}`;
(4) run-now first → 202 jobId string, second → 202 jobId null; (5) disable module then invoke →
404. Also: append `external-modules/job-search/src/web/index.ts` to the walked entry roots in
`tests/unit/module-web-browser-safety.test.ts`, and **`rm tests/integration/js06-invoke-smoke.test.ts`**
(temp file, header says DO NOT COMMIT — it is still uncommitted on disk; delete, never stage).
Verify: `pnpm vitest run tests/unit/module-web-browser-safety.test.ts` +
`pnpm test:integration -- js06-module-surface` (never trust `| tail` exit codes). Commit
`test(job-search): permanent surface data-plane guards; extend browser-safety walk (#935)` with
explicit adds of exactly those two test files. Then T11 (e2e via `tests/e2e/mock-modules.ts`
extension: real built bundle + mocked invoke/run-now, interactions, screenshots), T12 full gate
(`pnpm build:external:job-search && pnpm verify:foundation`) + pre-push trio + rebase, →
`coordinated-wrap-up` (PR `Closes #935` + report to Coordinator).

## Task-10 verified facts (do NOT re-explore — all confirmed on this branch)

- Invoke route: `POST /api/ai/assistant-tools/:name/invoke` (`packages/ai/src/routes.ts:577`).
  404 body message `"Assistant tool is not declared"` when tool unknown OR module disabled.
  Non-read risk → createPendingAssistantAction + 403. Response serializer
  `serializeAssistantToolInvocation` (`routes.ts:806`) → `{moduleId, moduleName, name, description,
  permissionId, risk, status, blockedReason, actionRequestId, result}` wrapped as `{invocation}`.
  GET `/api/ai/assistant-tools` → `{tools}` incl. `moduleId`.
- Run-now route: `apps/api/src/external-module-jobs.ts` — `POST
  /api/modules/:moduleId/queues/:queueName/run`; requires module ACTIVE + queue
  `allowManualRun` else 404; body keys only `{jobKind, params}`; → `202 {jobId}`;
  pg-boss `singletonKey = manual:${moduleId}:${queueName}:${actorUserId}` so second submit while
  queued → `jobId: null`. `job-search.monitor-run` has `allowManualRun: true`
  (`external-modules/job-search/jarvis.module.json:355`).
- pg-boss: `createApiServer` creates + STARTS its own boss by default (`apps/api/src/server.ts:197`,
  start ~:599) — run-now works in the integration harness with no extra setup.
- Harness template (`tests/integration/external-module-job-search.test.ts`): signUp helper (POST
  `/api/auth/sign-up/email`, join set-cookie), bootServer closure, resetEmptyFoundationDatabase →
  buildExternalModule → mkdtemp modulesDir (cpSync jarvis.module.json + dist) →
  `createApiServer({enableExternalModules, externalModulesDir})` → first signup = admin → enable
  via `POST /api/admin/external-modules/job-search {enabled:true}` (same route with
  `{enabled:false}` disables, for test 5). beforeAll timeout 120_000; afterAll
  Promise.allSettled(close, destroy, rmSync).

## Unit-harness gotchas (already handled in committed tests; reuse if writing more)

renderToString inserts `<!-- -->` between adjacent JSX text nodes (assert single template
literals) AND HTML-escapes `&`→`&amp;` (T6 test uses `label.replace(/&/g, "&amp;")`).
Runtime-install helper must be the FIRST import. `useSyncExternalStore` needs the 3rd
getServerSnapshot arg or renderToString throws. Custom components used in lists need an explicit
`key?: string` prop (runtime's loose JSX typing has no implicit key slot — see ModuleLink,
MonitorRow, MonitorDetailRow precedent).

## Coordinator rulings (binding — unchanged)

Model C: reads via invoke route only; run-now via queue route, no polling; module id `job-search`
NOT `jarv1s.job-search`; JSX via esbuild jsxFactory shim off frozen
`window.__JARVIS_MODULE_RUNTIME__` (web bundle react-free). **ZERO host code is a hard line —
anything tempting a host-code or packages/shared contract change → STOP + [DESIGN-FORK] (bumps to
security tier).** SECURITY (do not weaken): only risk:read executes on REST (write tools 403
`confirmation_required`); dispatch is `withDataContext(accessContext)`, never
actorUserId-from-body; external strings TEXT-only + escaped; disabled = fail-closed, no actions;
run-now params = IDs only. Plan-approval rulings: local fetch helper SAME-ORIGIN AUTHENTICATED
mirroring module-web-sdk `requestJson`; no react-query; URL-only, NO core nav entry; wall-clock +
IANA zone label. Exit criteria stand — nothing deferred.

## Bans still in force

Explicit-path `git add` only; never touch `docs/coordination/`, board, merges; caveman comms to
Coordinator, conventional in artifacts; pre-push trio + rebase before every push; relay at 70%
meter as Fable, same worktree. JDS: jds-* primitives only, module `jsm-*` classes layout-only,
no curved left-border accents.
