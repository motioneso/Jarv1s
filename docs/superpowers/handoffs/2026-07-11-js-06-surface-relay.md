# Relay — JS-06 job-search module surface (FABLE)

Successor: you are FABLE (handoff mandates Fable model), continuing JS-06 via `coordinated-build`.
Task issue #935 (epic #913). Worktree = this one; branch `feat/js-06-module-surface` rooted at
origin/main `9d4589d1` (JS-01..05 included). Read by SECTION only:

- Handoff (bans, risk tier): `docs/coordination/2026-07-11-js-06-build-handoff.md` (read-only, NEVER commit)
- Spec: `docs/superpowers/specs/2026-07-10-job-search-js-06-module-surface.md` (57 lines, safe to read fully)
- Coordinator: label `Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f` (resolve pane fresh by label; exactly one)

## Where the build stands

Done: orient, spec-vs-branch verification, one [DESIGN-FORK] escalation (RESOLVED — ruling below),
mandated smoke test (passed). **No plan written yet; NO code approval yet.**

NEXT STEP: invoke `superpowers:writing-plans` → write
`docs/superpowers/plans/2026-07-11-js-06-module-surface.md` → message Coordinator "plan ready for
js-06-module-surface: <path>. Approve, or flag a fork." → STOP until approval → TDD build →
`coordinated-wrap-up` (PR `Closes #935`).

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

## Plan sketch (starting point, not approved)

1. Build infra: jsxFactory shim + module-web-sdk alias in build script; bundle react-free assert;
   extend browser-safety walk to external web src. 2. Runtime accessor + internal router + api
   client (invokeTool/runNow) + unit tests. 3. Overview (onboarding %, monitor health, last
   success, next due, run-now). 4. Onboarding screen + #916 starter drafts per step. 5.
   Profile/resume approved-revision metadata + return-to-assistant. 6. Monitors config/health +
   run-now queued-state. 7. Opportunities shell (JS-08-ready routes). 8. Disabled/degraded
   fail-closed (invoke 404 → disabled state) + permanent integration tests (read ok / write 403 /
   run-now dedupe). 9. Nav entry (scope-flag). 10. E2E real-bundle interaction + screenshots
   light/dark. JDS: serif headings/mono eyebrows/sans body, jds-* only, no new raw colors, no
   curved left-border accents, external text as text.

## Bans still in force

Explicit-path `git add` only; never touch `docs/coordination/`, board, merges; caveman comms to
Coordinator, conventional in artifacts; pre-push trio + rebase before every push; relay at 70%
meter as Fable, same worktree.
