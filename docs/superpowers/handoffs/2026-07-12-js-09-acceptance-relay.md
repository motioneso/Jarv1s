# Relay — js-09-acceptance (2026-07-12)

Successor: continue JS-09 acceptance harness (issue #938, epic #913). You are Fable (hard
policy: Job Search builder = Fable). Same worktree/branch: `feat/js-09-acceptance` off
`ba4ed180`. Coordinator label `Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f`
(resolve pane fresh by label; verify session id before anything destructive).

## State

- Plan APPROVED by coordinator: `docs/superpowers/plans/2026-07-11-js-09-acceptance.md`
  (committed). Read it BY TASK, not in full.
- Mission doc: `docs/coordination/handoff-js-09-acceptance.md` (READ ONLY — never `git add` it
  or anything under `docs/coordination/`).
- Recon for plan Task 1 COMPLETE (verified facts below). ZERO test code written yet.
- Coordinator approval bars (must hold): (a) every cross-owner/admin denial paired with a
  positive control, no BYPASSRLS; (b) sentinel scan proves no private resume/profile/query
  content in job payloads, worker logs, or evidence artifact — state sentinel constants + scan
  pattern in PR body. Evidence destination = counts-only comment on issue #938 (confirmed).
  Any defect fix needing a migration/new endpoint/new schema → STOP, escalate.

## Next step (plan Task 1)

Write `tests/integration/external-module-job-search-acceptance.test.ts`, run
`pnpm vitest run tests/integration/external-module-job-search-acceptance.test.ts` to green,
commit explicit paths (test file only; plan already committed) with message
`test(job-search): JS-09 acceptance E2E — real-hash enable, six checkpoints, scheduled sweep with sentinel privacy scan, drift refusal (#938)`
+ `Co-Authored-By: Claude` trailer. Then plan Tasks 2–4.

## Recon-locked facts (verified on branch — do not re-derive)

- **Discovery:** `getExternalModuleRegistrations({modulesDir, coreVersion})`
  (`packages/module-registry/src/node.ts:32`) → `{discoveries, rejected}`; entries FLAT
  `{id, dir, manifest, manifestHash, packageHash}`. Pick `id === "job-search"`. modulesDir =
  `fileURLToPath(new URL("../../external-modules", import.meta.url))`; coreVersion from root
  package.json.
- **Payload:** `{actorUserId: ids.userA, moduleId: "job-search", jobKind: "job-search.monitor-sweep", manifestHash: registration.manifestHash}`.
  `assertModuleJobPayload` (`packages/jobs/src/module-jobs.ts`) enforces
  `/^sha256:[0-9a-f]{64}$/` — the harness's fake `sha256:job-search` hashes FAIL it; must use
  real registration hashes end-to-end.
- **Job handler deps** (`apps/worker/src/external-module-job-handler.ts`): `{module: registration, queue: registration.manifest.worker.queues[0], runtime, workerDb, dataContext, cipher: createModuleCredentialSecretCipher(), discoveryById: new Map([["job-search", registration]]), listActiveUserIds: async () => [ids.userA], ai: async (scopedDb, moduleId, request) => ({ok: true, object: okEvaluation})}`.
  Flow: assert payload → active user → discoveryById → DB triple check (status enabled +
  manifest_hash + package_hash match current) else silent return → rpc (toolRisk "write") →
  `runtime.invoke(...)`.
- **Fixture fetch:** wrap runtime — intercept rpc method `fetch.request`, return
  ModuleFetchResponse `{status: 200, headers: {"content-type": "application/json"}, bodyBase64: Buffer.from(body).toString("base64")}`
  (NOT bodyText — that's the module-internal AdapterFetch shape;
  `packages/module-registry/src/external/worker-rpc-host.ts:94`). Delegate all other methods to
  the real rpc. Fixture: `tests/fixtures/job-search/greenhouse-board.json` (real GitLab board →
  monitor `query: {board: "gitlab"}`, `adapterId: "greenhouse"`).
- **Clock:** spawned worker uses REAL clock (`now: () => new Date()`,
  `external-modules/job-search/src/worker/index.ts:35`) — no time injection through the job
  path. Monitor must use `dueTime: "00:00"`, `timezone: "UTC"` so it is always due. Second
  same-day sweep → `{ran: 0, skipped: 1}` + kv row counts unchanged (daily slot consumed);
  greenhouse courtesy interval 1h blocks refetch anyway. Content-dedup is already unit-covered —
  don't try to re-test it E2E.
- **Six checkpoints** (sequence copied from
  `tests/unit/external-module-job-search-handlers-onboarding.test.ts:246`): saveResumeDraft
  (mode "manual") → critique via ai stub → approveResume({revisionId: critique.revisionId}) →
  saveProfileDraft({provenance: "user", fields: {...}}) → approveProfile → saveMonitor
  (disabled, then enabled). Critique-stub `proposedMarkdown` must EQUAL a whole line of the
  pasted resume (whole-segment coverage guard); stub shape
  `{critiqueSummary, proposedMarkdown, materialClaims: [{kind, text, quote}]}`.
  `getStateHandler` → `{status: "ok", step, completed, gates: {resumeApproved, profileApproved, monitorEnabled}, ...}`.
  Run checkpoints over real RPC kv:
  `kvForActor({module: registration, workerDb, requestIdPrefix: "js09-accept"}, ids.userA)`
  from `tests/integration/job-search-rpc-harness.ts`; ports `{kv, ai: stub, now: () => NOW}`.
- **Valid AI evaluation object** (okAi in
  `tests/unit/external-module-job-search-handlers-run.test.ts`):
  `{fitBand: "strong", recommendation: "review", evidence: [{requirement, evidence, source: "resume"}], blockers: [], gaps: [], unknowns: [], preferenceMatches: [], preferenceConflicts: [], postingConfidence: "high", overallConfidence: "medium", summary: "..."}`.
- **Suite skeleton:** copy `tests/integration/js08-decide-confirm-audit.test.ts` beforeAll —
  `resetFoundationDatabase()`, `buildExternalModule(jobSearchSourceDir)`, bootstrap `Client`,
  worker `createDatabase({maxConnections: 1})`, `new ExternalModuleWorkerRuntime({logger})`,
  enabled-row INSERT
  `(id,status,manifest_hash,package_hash,enabled_at,enabled_by) VALUES ('job-search','enabled',$1,$2,now(),$3)`
  with real registration hashes + ids.adminUser; 120s timeout; afterAll Promise.allSettled
  close/end/destroy. Runtime logger `{warn: (obj, msg) => workerLogs.push(JSON.stringify({obj, msg}))}`
  captures worker log lines for the sentinel scan.
- **Sentinels:** `JS09-ACCEPT-RESUME-SENTINEL-93d1c4`, `JS09-ACCEPT-PROFILE-SENTINEL-93d1c4`,
  `JS09-ACCEPT-QUERY-SENTINEL-93d1c4`. Seed in resume content / profile fields / monitor query
  extra field (verify saveMonitor input schema tolerates it — else seed query board-name-adjacent
  field per plan). Assert ABSENT in: sweep job payload JSON, workerLogs, kv rows under
  `job-search.runs` / opportunities / feed namespaces. Positive control: sentinel IS present in
  the resume revision kv row.
- **Drift test:** append junk to `external-modules/job-search/dist/worker.js`, recompute
  registration (packageHash differs), fresh handler with drifted discoveryById → contributes
  nothing (0 kv writes, silent return); RESTORE the file in `finally`.

## Cadence rules

- Meter 70% warning or compaction summary → message Coordinator, `relay` skill, successor Fable.
- Pre-push trio + rebase before every push; full gate at wrap-up (`coordinated-wrap-up`).
- Explicit-path `git add` only; never touch board/milestones/merge; terse caveman comms to
  Coordinator; conventional prose in commits/PR.
