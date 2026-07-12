# Relay — JS-06 job-search module surface (FABLE)

Successor: you are FABLE (handoff mandates Fable model), continuing JS-06 via `coordinated-build`.
Task issue #935 (epic #913). Worktree = this one; branch `feat/js-06-module-surface` rooted at
origin/main `9d4589d1` (JS-01..05 included). Read by SECTION only:

- Handoff (bans, risk tier): `docs/coordination/2026-07-11-js-06-build-handoff.md` (read-only, NEVER commit)
- Spec: `docs/superpowers/specs/2026-07-10-job-search-js-06-module-surface.md` (57 lines, safe to read fully)
- Coordinator: label `Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f` (resolve pane fresh by label; exactly one)

## Where the build stands (updated relay 5, 2026-07-11)

**Plan Tasks 1–10 COMMITTED GREEN** (RED-GREEN-commit each): `5df78462` T1 jsx shim + runtime ·
`27020ca9` T2 api.ts client · `e76efa8a` T3 store/router/format · `7240aef0` T4 Root shell +
states + starter drafts · `e7910dcd` T5 Overview · `e8a0ac66` T6 Onboarding · `931ba104` T7
Profile & resume · `09564dc6` T8 Monitors + RunNowButton · `84a8cac1` T9 Opportunities shell ·
**`40a11728` T10 integration guards + browser-safety walk + #965 comments**. Verified at T10:
unit 34/34, integration 5/5 exit 0. Temp smoke test `tests/integration/js06-invoke-smoke.test.ts`
was DELETED (never committed) — do not recreate.

**THE PLAN IS THE SINGLE SOURCE OF TRUTH:**
`docs/superpowers/plans/2026-07-11-js-06-module-surface.md` — read PER TASK (by section), never
front-to-back. Section offsets: T11@2331 T12@2367 exit-criteria@2389.

NEXT STEP (immediately): **Task 11 — e2e real-bundle spec + screenshots** (plan line ~2331).
Exploration is DONE (facts below) — write directly. (a) Extend `tests/e2e/mock-modules.ts` with
`mockExternalWebModuleFromDist(page, options?)` serving the REAL built bundle
`external-modules/job-search/dist/web/index.js` from disk (options: `invokeFixtures` per tool
name, `runNowJobIds` default `["job-1", null]`, `invokeStatus` 404 for disabled). (b) Create
`tests/e2e/js06-module-surface.spec.ts`, 5 scenarios per plan: real-data render (monitor row
"daily at 07:00 · America/New_York"); onboarding→composer handoff prefills WITHOUT auto-submit
(#916); run-now queued then already-queued via aria-live, button disabled after settle
(jobId:null path is MOCK-driven — valid despite #965 defer); disabled fail-closed "Job Search is
turned off", no Continue button; light/dark screenshots of Overview/Onboarding/Monitors →
`test-results/js06-screens/{route}-{theme}.png`. beforeAll builds bundle once via
`execSync("pnpm build:external:job-search", ...)`. Run: `pnpm test:e2e -- js06-module-surface`
(frontend gate only, no PG — safe alongside other agents). Commit `test(job-search): e2e
real-bundle surface interactions + light/dark screenshots (#935)` — explicit adds of exactly
those two files. Then T12: `pnpm build:external:job-search && pnpm verify:foundation` (record
exit codes), pre-push trio + `git fetch origin main && git rebase origin/main`, confirm nothing
from `docs/coordination/` or `.claude/context-meter.log` staged → `coordinated-wrap-up` (push,
PR `Closes #935` with user-facing "What's new" line, report PR + evidence to Coordinator).

## Task-11 verified facts (do NOT re-explore)

- `tests/e2e/mock-modules.ts`: exports `modulesResponse`, `myModulesResponse`,
  `mockExternalModules(page)`, `mockExternalWebModule(page)` — moduleId `job-search`, entrypoint
  `dist/web/index.js`, navigation path `/m/job-search` order 60. Bundle route glob is
  `**/api/modules/job-search/web/dist/web/index.js*` — the trailing `*` is REQUIRED (Vite adds
  `?import`). Fulfill with `contentType: "text/javascript"`. Bundle reads host React from
  `window.__JARVIS_MODULE_RUNTIME__`.
- `tests/e2e/external-modules.spec.ts` (structure template): call `mockApi(page, {authenticated:
  true, connectorAccounts: [], connectorProviders: [], notifications: [], tasks: []})` FIRST,
  module mocks AFTER — most-recently-registered `page.route` wins. Chat submit detection:
  `page.route("**/api/chat/turn", ...)` + turnPosted flag. Composer =
  `page.getByRole("textbox", { name: "Message Jarvis" })`. Keyboard activation =
  `button.press("Enter")`. jds Switch renders a checkbox role; click the `label.jds-switch`.

## Traps confirmed this run (bug memory saved: pg-boss singletonKey)

- **pg-boss v12 singletonKey dedupe is policy-gated**: only short/singleton/stately-policy queues
  have the partial unique index; external module queues are created standard-policy by the worker
  reconciler → singletonKey silently no-ops. Host fix = issue #965 (deferred, own branch).
- **API-only integration harness must provision external queues itself**:
  `await migratePgBoss(connectionStrings.migration, [{name: "job-search.monitor-run", options:
  {retryLimit: 3}}])` in beforeAll, or run-now's boss.send throws → 503. (The worker reconciler
  isn't in the API harness.)
- **Single-file integration run**: `pnpm tsx scripts/test-integration.ts
  tests/integration/js06-module-surface.test.ts` — the `pnpm test:integration -- <filter>` form
  does NOT filter (runs all 141 files, ~11 min). Never trust `| tail` exit codes.
- `chat-recall.test.ts` "tuple concurrently updated" during full-suite runs = multi-agent PG
  contention (environmental), not a regression.

## Coordinator #965 DEFER ruling (binding, Opus-adjudicated)

1. Integration test 4 asserts 202-only (both submits) — already committed that way; do NOT
   tighten until #965 lands. 2. Manual-path singletonKey stays as-is (no host change). 3. KEEP
   RunNowButton's jobId-null "already queued" branch — dead-but-defensive, lights up when #965
   lands. 4. #965 comments already placed in `api.ts` + the integration test. **ZERO host code
   remains the hard line — any host/packages/shared temptation → STOP + [DESIGN-FORK].**

## Coordinator rulings (binding — unchanged)

Model C: reads via invoke route only; run-now via queue route, no polling; module id `job-search`
NOT `jarv1s.job-search`; JSX via esbuild jsxFactory shim off frozen
`window.__JARVIS_MODULE_RUNTIME__` (web bundle react-free). SECURITY (do not weaken): only
risk:read executes on REST (write tools 403 `confirmation_required`); dispatch is
`withDataContext(accessContext)`, never actorUserId-from-body; external strings TEXT-only +
escaped; disabled = fail-closed, no actions; run-now params = IDs only. Local fetch helper
SAME-ORIGIN AUTHENTICATED; no react-query; URL-only, NO core nav entry; wall-clock + IANA zone
label. Exit criteria stand — nothing deferred except #965 (host-side, out of scope).

## Bans still in force

Explicit-path `git add` only; never touch `docs/coordination/`, board, merges; caveman comms to
Coordinator, conventional in artifacts; pre-push trio + rebase before every push; relay at 70%
meter as Fable, same worktree. JDS: jds-* primitives only, module `jsm-*` classes layout-only,
no curved left-border accents.
