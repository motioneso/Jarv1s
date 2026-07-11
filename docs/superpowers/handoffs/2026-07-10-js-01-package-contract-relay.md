# Relay — JS-01 package contract (#930) — verification done, plan NOT yet written

**You are the Fable successor** (`claude-fable-5`; relay successors stay Fable — scoped exception
to the Sonnet rule, per handoff). Worktree
`~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/js-01-package-contract`,
branch `feat/js-01-package-contract` @ `2f4a0fe3`. Coordinator label `Coordinator`, session id
`58a78927-385c-4b1d-8fa0-94db20255d6f` (verify EXACTLY ONE pane, resolve fresh).

Resume via `coordinated-build`. Handoff doc (READ IT):
`docs/coordination/2026-07-11-js-01-package-contract-handoff.md` (untracked — never commit).
Spec: `docs/superpowers/specs/2026-07-10-job-search-js-01-package-contract.md` (69 lines, read fully).
**Do NOT re-verify the platform files below — that work is DONE; findings here are current @ 2f4a0fe3.**

## State

- No code written. Plan approval gate NOT passed. Next step = write plan
  (`superpowers:writing-plans` → `docs/superpowers/plans/2026-07-10-js-01-package-contract.md`),
  message Coordinator for approval, STOP until approved.
- Coordinator was already messaged the 2 fork items below (awaiting its ruling — check for a reply
  before re-asking).

## FORKS (coordinator must rule; recommendation already sent)

1. **Dotted id.** Spec/design say id `jarv1s.job-search`; merged ABI forbids dots:
   `MODULE_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/` (validate.ts:24, predates spec grounding
   `eafa22dd`) and dir name must equal id (node.ts loader). **Rec:** id `job-search`, dir
   `external-modules/job-search/`, all identifiers `job-search.*`.
2. **Shared permission ids.** Design's 4 shared permissions (`.read`, `.manage-profile`,
   `.manage-monitors`, `.decide`) violate merged rule "assistant tool permission ids must be
   unique" (validate.ts:392). **Rec:** `permissionId == tool name` for JS-01; revisit JS-06.

## Verified ABI facts (all @ 2f4a0fe3 — cite, don't re-read broadly)

- **Manifest** (`packages/module-registry/src/external/validate.ts`, 450 ln): `schemaVersion` must
  be literal `1`; id/name/version/publisher/lifecycle required; `compatibility.jarv1s` single
  comparator ONLY (`>=0.1.0` ok; compound `>=a <b` UNSUPPORTED → fail-closed; CORE_VERSION
  `0.1.0`). FORBIDDEN_FIELDS rejects `permissions`, `routes`, `jobs`, `database`, `navigation` etc.
  Allowed: `auth` (kind `api-key` only — spec says NO MVP credentials → omit), `storage`
  (namespace `<id>` or `<id>.<slug>`, scopes `["user"|"instance"]`), `web`
  ({entrypoint: clean rel path, contractVersion: positive int; host expects 1}), `runtime`
  (workerEntrypoint EXACTLY `"dist/worker.js"`, workerContractVersion EXACTLY `1`),
  `assistantTools` ({name, permissionId, description, risk: read|write|destructive, handler};
  name+permissionId prefixed `<id>.`; names/permissionIds/handlers each unique; requires
  `runtime`), `worker` ({queues ≤16: {name prefixed `<id>.`, handler, retryLimit ≤10, optional
  paramsSchema/deadLetterQueue}; schedules ≤32: {id `^[a-z][a-z0-9_.-]{0,63}$`, cron 5-field,
  scope MUST be `"user"`, jobKind same grammar, queue must ref declared queue; params only if
  queue has paramsSchema}), `fetchHosts` (lowercase hostname, no port/IP —
  `assertValidFetchHosts` in `packages/host-fetch/src/policy.ts` is syntactic only, no central
  registry). Worker/fetchHosts require `runtime`.
- **Loader** (`packages/module-registry/src/node.ts` `getExternalModuleRegistrations({modulesDir,
  coreVersion, reservedQueueNames})`): per-dir fail-closed; dir name = id; symlink containment on
  dir + manifest; never leaks paths (error CODE/NAME tokens only).
- **Hash** (`external/hash.ts`): `hashCanonicalManifest` + `hashExternalPackage` (hashes
  `jarvis.module.json`, `dist/worker.js`, `dist/web/**` only; realpath containment,
  `ExternalPackageEscapeError` on symlink escape; package.json NOT hashed).
- **Reconcile** (`external/reconcile.ts`): no row → `discovered`/inactive; disabled → inactive;
  enabled+hash match → active; enabled+drift → auto-disable, `DRIFT_DISABLED_REASON`.
- **Web contract v1** (`apps/web/src/external-modules/loader.ts` — COLLISION: tell coordinator at
  wrap-up if touched, #916 lane): bundle = ESM, default export `{contractVersion: 1, Root}`;
  react/react-dom externalized to frozen global `window.__JARVIS_MODULE_RUNTIME__`
  (`.react`, `.reactDomClient`); served at `/api/modules/:id/web/<entrypoint>`; asset types
  limited to `.css .js .json .map .mjs .png .svg .woff2` (`web-assets.ts`).
- **Worker contract** (`worker-runtime.ts` + `packages/module-sdk/src/worker.ts`): host spawns
  `node <dir>/dist/worker.js`, cwd=module dir, env scrubbed to LANG/LC_ALL/TZ, JSON-RPC over
  stdio; child uses SDK `defineModuleWorker({handlers})` (ctx: input/auth/fetch/kv), emits
  `{method:"worker.ready", params:{version: MODULE_WORKER_CONTRACT_VERSION}}`; unknown handler →
  error `-32601 handler_not_found`. Artifact package.json without `"type"` → build worker as
  CJS; bundle SDK in (alias `@jarv1s/module-sdk/worker` → `packages/module-sdk/src/worker.ts`).
- **Env flags:** `JARVIS_ENABLE_EXTERNAL_MODULES=1` + `JARVIS_MODULES_DIR` (server.ts:138,
  worker.ts:80).
- **Routes** (integration pattern in `tests/integration/external-modules-routes.test.ts` — copy
  its harness: real server + temp modules dir + better-auth first-signup admin cookie):
  `GET/POST /api/admin/external-modules[/:id]`, `GET /api/modules`,
  `POST /api/modules/:id/queues/:queue/run`.
- **Repo wiring:** workspace globs = `apps/* packages/* spikes/*` → `external-modules/` naturally
  outside. `.dockerignore` has NO external-modules entry yet (add one). Root tsconfig include has
  NO external-modules (add separate `tsc -p external-modules/job-search --noEmit` script; core
  image build must never compile it). `eslint .` + `prettier --check .` WILL cover the new dir
  (dist/ ignored). `pnpm test:unit` = `vitest run tests/unit`. Registry accessor for absence
  test: `getBuiltInModuleManifests()` (module-registry). esbuild 0.25.12 at root.
- **Design cross-refs** (module-design spec ln 121–131, 336–351): 7 user KV namespaces =
  `.onboarding .profile .resume .monitors .opportunities .runs .feed`; 13 assistant tools
  (onboarding.get-state; profile.get/save-draft/approve; resume.get/save-draft/approve;
  monitor.list/get/save; opportunities.list/get; opportunity.decide). Fetch hosts (JS-04:
  Greenhouse/Lever/Ashby keyless public): `boards-api.greenhouse.io`, `api.lever.co`,
  `api.ashbyhq.com`.

## Plan skeleton (validated against above; flesh into writing-plans format)

1. `external-modules/job-search/jarvis.module.json` (full contract manifest per facts above; one
   queue `job-search.monitor-run` handler `monitor.run` retryLimit 3 + one schedule
   `job-search.monitor-sweep` cron `*/15 * * * *` scope user jobKind `job-search.monitor-sweep`,
   no params) + unit test `tests/unit/external-module-job-search-manifest.test.ts` running REAL
   manifest through `validateExternalModuleManifest` (ok + mutation rejections: dotted id, dup
   permissionId, bad schemaVersion, forbidden field).
2. `.dockerignore` += `external-modules` + absence unit test (dockerignore line;
   `getBuiltInModuleManifests()` has no `job-search`; workspace globs unchanged).
3. Package sources: `src/web/index.ts` (React.createElement placeholder Root, default export
   contract), `src/worker/index.ts` (`defineModuleWorker`, 14 handlers = 13 tool stubs
   returning `{status:"not-implemented"}` + `monitor.run`), `package.json` (private, no `type`),
   local `tsconfig.json` (paths → SDK src), `README.md` (contract doc — risk tier asks for it).
4. `scripts/build-external-module.ts` (exported `buildExternalModule(dir)`: esbuild worker
   bundle=CJS/node self-contained; web bundle=ESM/browser, react shims → global) + root scripts
   `build:external:job-search`, `check:external-modules` (chain into `typecheck`) + bundle
   inspection unit test (web: no `node:`/no bundled react, has `__JARVIS_MODULE_RUNTIME__`;
   worker: spawn `node dist/worker.js` in bare temp dir w/o node_modules → emits `worker.ready`,
   unknown handler → `-32601`).
5. Fail-closed unit tests on built artifact (copy to temp): loader discovers+hashes; tampered
   `dist/worker.js` → new packageHash; symlink in `dist/web` escaping dir → rejected; `../`
   entrypoint manifest → rejected; contractVersion 2 → loader ok but web loader gate (assert
   manifest gate value) / wrong `workerContractVersion` → rejected; malformed JSON → rejected.
6. Integration `tests/integration/external-module-job-search.test.ts` (copy routes-test harness;
   build real package into temp modulesDir): discovered→inactive; enable→active+web contribution
   listed; tamper→drift auto-disable; explicit disable→inactive; member `GET /api/modules` shows
   contributions only when active.
7. Gate: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:unit`, integration suite,
   pre-push trio + fresh rebase. NO migration (flag if that changes). e2e NOT in scope (spec
   verification list has none; existing generic e2e stands).

## Bans still live

Explicit-path `git add` only; never touch `docs/coordination/`; no board/merge; no platform-internal
edits (everything lands under `external-modules/`, `scripts/build-external-module.ts`, `tests/`,
`.dockerignore`, root package.json scripts, plan doc). Prettier-format any doc you commit
(handoff-doc prettier trap). Caveman-terse comms to Coordinator; conventional commits/PR.
