# External Worker Capabilities Implementation Plan

> **For the coordinated build agent:** REQUIRED SUB-SKILLS: use `coordinated-build` and
> `superpowers:test-driven-development`; execute each task inline because this repository disables
> `executing-plans` and `subagent-driven-development`. Every step uses checkbox syntax for tracking.

**Goal:** Add manifest-declared external-module queues, recurring per-user schedules, run-now
enqueueing, and an SSRF-safe host-pinned fetch capability without rebuilding the structured-AI seam
already shipped in PR #923.

**Architecture:** Extend the existing external manifest and child-process runtime instead of adding
a second module host. Keep job payload validation in `@jarv1s/jobs`, desired-state reconciliation in
the server-only module registry, and HTTP policy in one small server-only package shared by datasets
and module RPC. The worker remains the only cron/worker-registration owner; API paths only enqueue
control jobs or make targeted schedule writes.

**Tech Stack:** TypeScript 6, Node `https`/`dns` standard library, Fastify 5, Kysely, pg-boss 12,
Vitest, PostgreSQL RLS.

## Global Constraints

- Scope is Goal #1 and Goal #3 only. Do not modify the structured-AI RPC seam from PR #923.
- Generic contracts only: no consumer-specific queue names, hosts, prompts, or job kinds in core.
- Preserve the global `ALLOWED_PAYLOAD_KEYS` and `assertMetadataOnlyPayload` unchanged.
- pg-boss payloads contain metadata only; never private content, prompts, fetched bodies, or secrets.
- `AccessContext` remains `{ actorUserId, requestId }`; all actor data access uses `DataContextDb`.
- Only `apps/worker` enables pg-boss schedule/supervise and registers external queue handlers.
- Migration is assigned `packages/settings/sql/0158_external_module_active_users.sql`.
- The SECURITY DEFINER function pins `search_path`, is executable only by
  `jarvis_worker_runtime`, returns only user ids, and performs no general RLS bypass.
- External fetch is HTTPS port 443 only, exact-host allowlisted, DNS-resolved to globally routable
  addresses, connected to the validated address with TLS SNI/Host forced to the validated host.
- Request and response bytes are bounded while streaming; caller `Host`/hop-by-hop headers are
  rejected; all caller headers are removed on cross-origin redirects.
- Stage only explicit files. Never edit `docs/coordination/`, applied migrations, project boards,
  milestones, or merge state.

## Verified Branch State and Review Forks

- Branch contains #919's child runtime and migration 0157. `ExternalModuleWorkerRuntime`,
  `createExternalModuleRpcHandler`, `ctx.auth`, and `ctx.kv` are reused.
- `JsonJarvisModuleManifest` has no queue/schedule/fetch declarations; the external validator still
  has no worker-job validation.
- `sendModuleJob`, `assertModuleJobPayload`, `platform.module-control`, external queue registration,
  schedule fan-out, run-now route, and `ctx.fetch` are absent.
- `createHostPinnedFetch` still lives in datasets, compares hostname without port, delegates DNS and
  connection selection to global fetch, buffers without a response cap, and strips only
  `authorization` on hostname changes.
- Review fork A: worker role cannot persist `app.external_modules.status='disabled'` because writes
  are admin-only and the approved data model authorizes only one new enumeration function. This plan
  fails a broken module closed in the worker process, logs only module id/error name, and retries on
  the next startup/control reconcile; it does not invent a worker admin-bypass write seam.
- Review fork B: no live external-module uninstall endpoint/hook exists. This plan purges orphaned
  schedules/workers/queues whenever startup or a control message sees a missing discovery; it does
  not add an unapproved uninstall HTTP surface.

---

### Task 1: Manifest worker declarations and bounded metadata schemas

**Files:**

- Create: `packages/host-fetch/package.json`
- Create: `packages/host-fetch/tsconfig.json`
- Create: `packages/host-fetch/src/policy.ts`
- Modify: `packages/module-sdk/src/index.ts`
- Modify: `packages/module-registry/package.json`
- Modify: `packages/module-registry/src/external/validate.ts`
- Modify: `pnpm-lock.yaml`
- Test: `tests/unit/module-sdk-external-types.test.ts`

**Interfaces:**

- Consumes: existing `JsonJarvisModuleManifest`, `assertValidFetchHosts`, and external discovery.
- Produces: `ModuleParamsSchema`, `ExternalModuleQueueDeclaration`,
  `ExternalModuleScheduleDeclaration`, `ExternalModuleWorkerDeclaration`, `ModuleFetchRequest`,
  `ModuleFetchResponse`, and validated `manifest.worker` / `manifest.fetchHosts` values.

- [ ] **Step 1: Write failing manifest validation tests**

Add table-driven tests proving a valid declaration loads and each of these rejects: foreign queue
prefix, queue collision, duplicate queue/schedule, invalid five-field cron, foreign/undeclared
dead-letter target, dead-letter cycle, excessive queue/schedule counts, unbounded number schema,
free-form string schema, nesting deeper than two, invalid schedule queue/scope/timezone, uppercase or
IP-literal fetch host, and schedules/queues without a runtime.

Use this minimal valid fixture:

```ts
const worker = {
  queues: [
    {
      name: "fixture.sync",
      handler: "sync",
      retryLimit: 2,
      allowManualRun: true,
      paramsSchema: { type: "object", fields: { resourceId: { type: "uuid" } } }
    }
  ],
  schedules: [
    {
      id: "daily",
      cron: "0 8 * * *",
      tz: "UTC",
      queue: "fixture.sync",
      jobKind: "daily-sync",
      scope: "user",
      params: {}
    }
  ]
} as const;
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm vitest run tests/unit/module-sdk-external-types.test.ts`

Expected: FAIL because `worker`, `fetchHosts`, and the schema types/validator do not exist.

- [ ] **Step 3: Add the minimum public contracts**

Add these exact shapes to `packages/module-sdk/src/index.ts`:

```ts
export type ModuleParamScalarSchema =
  | { readonly type: "uuid" | "identifier" | "timestamp" | "boolean" | "null" }
  | { readonly type: "integer" | "number"; readonly min: number; readonly max: number }
  | { readonly type: "enum"; readonly values: readonly string[] };

export type ModuleParamsSchema =
  | ModuleParamScalarSchema
  | { readonly type: "array"; readonly items: ModuleParamScalarSchema; readonly maxItems: number }
  | {
      readonly type: "object";
      readonly fields: Readonly<
        Record<
          string,
          | ModuleParamScalarSchema
          | {
              readonly type: "array";
              readonly items: ModuleParamScalarSchema;
              readonly maxItems: number;
            }
        >
      >;
    };

export interface ExternalModuleQueueDeclaration {
  readonly name: string;
  readonly handler: string;
  readonly paramsSchema?: ModuleParamsSchema;
  readonly retryLimit?: number;
  readonly deadLetterQueue?: string;
  readonly allowManualRun?: boolean;
}

export interface ExternalModuleScheduleDeclaration {
  readonly id: string;
  readonly cron: string;
  readonly tz?: string;
  readonly queue: string;
  readonly jobKind: string;
  readonly scope: "user";
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ExternalModuleWorkerDeclaration {
  readonly queues?: readonly ExternalModuleQueueDeclaration[];
  readonly schedules?: readonly ExternalModuleScheduleDeclaration[];
}

export interface ModuleFetchRequest {
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly bodyBase64?: string;
}

export interface ModuleFetchResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyBase64: string;
}
```

Extend `JsonJarvisModuleManifest` with optional `worker` and `fetchHosts`. Keep runtime process
configuration in the existing `runtime` field.

- [ ] **Step 4: Implement one fail-closed validation path**

Create the minimal `@jarv1s/host-fetch/policy` browser-safe export containing the existing
`isPinnableHost` / `assertValidFetchHosts` rules, then import that policy from `validate.ts`. Add
constants for identifier formats, 2 KiB params, 4 KiB envelope, small queue and schedule limits,
and retry clamp. Validate and re-shape declarations; reject unknown schema types, arrays/objects
beyond depth two, dead-letter cycles, schedule references to undeclared queues, and invalid IANA
zones via `Intl.DateTimeFormat`. Run `pnpm install --lockfile-only` for the workspace dependency.

- [ ] **Step 5: Run focused tests and typecheck GREEN**

Run: `pnpm vitest run tests/unit/module-sdk-external-types.test.ts`

Run: `pnpm --filter @jarv1s/module-sdk typecheck && pnpm --filter @jarv1s/module-registry typecheck`

Expected: PASS.

- [ ] **Step 6: Commit task 1**

```bash
git add packages/host-fetch/package.json packages/host-fetch/tsconfig.json packages/host-fetch/src/policy.ts packages/module-sdk/src/index.ts packages/module-registry/package.json packages/module-registry/src/external/validate.ts pnpm-lock.yaml tests/unit/module-sdk-external-types.test.ts
git commit -m "feat(modules): validate external worker declarations" -m "External modules can safely declare bounded queues, schedules, and fetch hosts." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Dedicated external job envelope and platform control queue

**Files:**

- Create: `packages/jobs/src/module-jobs.ts`
- Modify: `packages/jobs/src/index.ts`
- Modify: `packages/jobs/src/pg-boss.ts`
- Test: `tests/unit/jobs-pg-boss.test.ts`

**Interfaces:**

- Consumes: `AccessContext`, pg-boss, validated queue declarations, and trusted discovery hashes.
- Produces: `ExternalModuleJobPayload`, `ModuleControlPayload`, `assertModuleJobPayload`,
  `sendModuleJob`, `sendModuleControl`, and `PLATFORM_MODULE_CONTROL_QUEUE`.

- [ ] **Step 1: Write failing payload and enqueue tests**

Prove actor id is always copied from `AccessContext`, trusted module/hash fields are stamped by the
wrapper, params formats/depth/count/byte caps are rechecked, `singletonKey` passes only as a pg-boss
option, and content-like/free-form keys reject. Snapshot `ALLOWED_PAYLOAD_KEYS` before and after and
prove `params`, `moduleId`, `manifestHash`, and `action` never enter it.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run tests/unit/jobs-pg-boss.test.ts`

Expected: FAIL on missing module-job exports.

- [ ] **Step 3: Implement the dedicated validators and wrappers**

Use these contracts in `module-jobs.ts`:

```ts
export interface ExternalModuleJobPayload {
  readonly actorUserId: string;
  readonly moduleId: string;
  readonly jobKind: string;
  readonly manifestHash: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ModuleControlPayload {
  readonly moduleId: string;
  readonly action: "reconcile";
}

export async function sendModuleJob(
  boss: PgBoss,
  access: AccessContext,
  module: Pick<ExternalModuleDiscoveryIdentity, "id" | "manifestHash">,
  queue: ExternalModuleQueueDeclaration,
  command: { readonly jobKind: string; readonly params?: Readonly<Record<string, unknown>> },
  options?: Pick<SendOptions, "singletonKey">
): Promise<string | null>;
```

Serialize before sending and reject over 4 KiB. Validate params against the queue schema before
calling `boss.send`. Give `ModuleControlPayload` its own exact-key validator and send wrapper.

- [ ] **Step 4: Register the static control queue**

Add `PLATFORM_MODULE_CONTROL_QUEUE = "platform.module-control"` to `pg-boss.ts` and one foundation
definition with short retention and bounded retries. Do not add module-declared queues to the static
migration list.

- [ ] **Step 5: Run focused tests and typecheck GREEN**

Run: `pnpm vitest run tests/unit/jobs-pg-boss.test.ts`

Run: `pnpm --filter @jarv1s/jobs typecheck`

Expected: PASS.

- [ ] **Step 6: Commit task 2**

```bash
git add packages/jobs/src/module-jobs.ts packages/jobs/src/index.ts packages/jobs/src/pg-boss.ts tests/unit/jobs-pg-boss.test.ts
git commit -m "feat(jobs): add metadata-only module job envelopes" -m "External worker jobs and control messages now pass dedicated bounded validators." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Active-user enumeration and desired-state queue/schedule reconciliation

**Files:**

- Create: `packages/settings/sql/0158_external_module_active_users.sql`
- Create: `packages/module-registry/src/external/job-reconciler.ts`
- Modify: `packages/module-registry/src/node.ts`
- Modify: `apps/worker/src/worker.ts`
- Test: `tests/integration/foundation.test.ts`
- Test: `tests/integration/worker-lifecycle.test.ts`

**Interfaces:**

- Consumes: validated discoveries, worker-role Kysely handle, pg-boss, child runtime, credential/RPC
  host, and `app.list_active_external_module_users(module_id text)`.
- Produces: `ExternalModuleJobReconciler.reconcileAll()`, `.reconcileModule(moduleId)`,
  `.reconcileUser(userId)`, `.purgeModule(moduleId)`, and `.close()`.

- [ ] **Step 1: Write failing migration and reconciliation tests**

Add integration assertions that 0158 is present after 0157, the function returns only active users
without an instance/user deny row for an enabled external module, inactive users are absent, PUBLIC
has no execute grant, app runtime cannot execute, worker runtime can execute, and the function owner
does not have BYPASSRLS.

Use fake pg-boss/runtime ports to prove: dead-letter queues create before source queues; repeated
reconcile registers once; options converge; per-user schedule keys are deterministic; stale/orphan
schedules are removed; disabled modules leave queues/jobs but stop workers and schedules; purge
removes schedules/workers/queues; one module failure does not block another.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run tests/integration/foundation.test.ts tests/integration/worker-lifecycle.test.ts`

Expected: FAIL because migration/function/reconciler are absent.

- [ ] **Step 3: Add the least-privilege SECURITY DEFINER migration**

Create exactly this security shape, with the final query limited to ids and deny rows:

```sql
CREATE OR REPLACE FUNCTION app.list_active_external_module_users(target_module_id text)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT users.id
  FROM app.users AS users
  WHERE users.status = 'active'
    AND EXISTS (
      SELECT 1 FROM app.external_modules AS modules
      WHERE modules.id = target_module_id AND modules.status = 'enabled'
    )
    AND NOT EXISTS (
      SELECT 1 FROM app.module_enablement AS denied
      WHERE denied.module_id = target_module_id
        AND (denied.scope = 'instance' OR
             (denied.scope = 'user' AND denied.user_id = users.id))
    )
$$;

REVOKE ALL ON FUNCTION app.list_active_external_module_users(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_active_external_module_users(text) TO jarvis_worker_runtime;
```

Create a dedicated `NOLOGIN NOBYPASSRLS` owner role for this function, grant it SELECT only on the
columns used above, and add role-specific RLS SELECT policies limited to this query's active-user,
external-module, and deny-row metadata. Transfer function ownership to that role, revoke temporary
schema CREATE/membership grants, and verify neither `jarvis_worker_runtime` nor the definer owns
BYPASSRLS. Never use `jarvis_bootstrap` as the function owner and never widen the worker's direct
`app.users` self-row policy.

- [ ] **Step 4: Implement one desired-state reconciler**

`job-reconciler.ts` owns a `Map<moduleId, Set<queueName>>` of process-local registrations. For each
active discovery: create/update dead-letter targets first, then source queues; `offWork` before
re-registering; register each queue through `registerDataContextWorker`; enumerate actor ids only
through the new function; schedule validated envelopes with key
`${moduleId}:${scheduleId}:${userId}`. Compare `boss.getSchedules()` against the desired key set and
unschedule stale keys. Catch per-module errors, remove that module's registrations/schedules, and log
only `{moduleId,errorName}`.

At delivery, inside `DataContextDb`, verify actor active, module row enabled, per-user/instance deny
absent, and current manifest/package hash trusted. Revalidate payload against the current queue
declaration; no-op on inactive/deleted actors, and throw on incompatible hash/schema so pg-boss
retry/dead-letter policy applies. Invoke the existing child runtime with:

```ts
{
  actorUserId: job.data.actorUserId,
  jobKind: job.data.jobKind,
  idempotencyKey: `${job.data.moduleId}:${job.data.jobKind}:${job.id}`,
  params: job.data.params ?? {}
}
```

- [ ] **Step 5: Wire worker startup and control handling**

Discover external modules from `JARVIS_ENABLE_EXTERNAL_MODULES` / `JARVIS_MODULES_DIR`, construct one
runtime and reconciler, register `platform.module-control`, call `reconcileAll()` after foundation
and built-in registration, and close runtime/reconciler during shutdown. A control job calls
`reconcileModule(moduleId)`; missing discoveries take the purge path.

- [ ] **Step 6: Run focused tests and typechecks GREEN**

Run: `pnpm vitest run tests/integration/foundation.test.ts tests/integration/worker-lifecycle.test.ts`

Run: `pnpm --filter @jarv1s/module-registry typecheck && pnpm --filter @jarv1s/worker typecheck`

Expected: PASS.

- [ ] **Step 7: Run full migration integration before commit**

Run: `pnpm test:integration`

Expected: PASS, including the full ordered migration list.

- [ ] **Step 8: Commit task 3**

```bash
git add packages/settings/sql/0158_external_module_active_users.sql packages/module-registry/src/external/job-reconciler.ts packages/module-registry/src/node.ts apps/worker/src/worker.ts tests/integration/foundation.test.ts tests/integration/worker-lifecycle.test.ts
git commit -m "feat(worker): reconcile external queues and schedules" -m "Enabled external modules now register isolated workers and per-user recurring jobs." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Authenticated run-now and lifecycle reconciliation signals

**Files:**

- Create: `apps/api/src/external-module-jobs.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `packages/settings/src/routes.ts`
- Modify: `packages/settings/src/routes-modules.ts`
- Modify: `packages/settings/src/me-account-routes.ts`
- Test: `tests/integration/module-registry.test.ts`

**Interfaces:**

- Consumes: boot discovery snapshot, active-module resolver, `sendModuleJob`,
  `sendModuleControl`, access-context resolver, and targeted schedule reconcile port.
- Produces: `POST /api/modules/:moduleId/queues/:queueName/run`, control messages after module
  enablement changes, and immediate per-user unscheduling on disable/deactivate/delete.

- [ ] **Step 1: Write failing route/lifecycle tests**

Prove run-now rejects unknown/inactive modules, undeclared queues, queues without
`allowManualRun`, invalid jobKind/params, and unauthenticated callers; returns only `{jobId}` on 202;
binds session actor; rate-limits by actor/module; and sends singleton key
`manual:${moduleId}:${queueName}:${actorUserId}`. Prove admin enable/disable and per-user toggle send
one metadata-only control message, while user deactivation/deletion removes matching schedule keys.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run tests/integration/module-registry.test.ts`

Expected: FAIL because route and lifecycle ports are absent.

- [ ] **Step 3: Implement the run-now route as a composition-root feature**

Register the route only when external modules are enabled. Resolve `AccessContext` first, then find
the trusted discovery/queue, require current actor activation, parse an exact object with bounded
`jobKind` and optional params, and call `sendModuleJob`. Configure a per-route limit using the
authenticated principal plus module id; never key on caller-controlled jobKind/queue headers.

- [ ] **Step 4: Add narrow lifecycle ports**

Extend settings dependencies with:

```ts
readonly reconcileExternalModuleJobs?: (change:
  | { readonly kind: "module"; readonly moduleId: string }
  | { readonly kind: "user"; readonly userId: string }
) => Promise<void>;
```

Call it only after the owning DB mutation commits. Module changes enqueue a control job. User
disable/reactivate, deactivation/reactivation, and deletion scan only external schedule keys ending
in that user id and schedule/unschedule from trusted manifest templates. Reconcile errors are
structured metadata-only warnings and do not roll back an already committed account mutation;
startup full reconcile remains the backstop.

- [ ] **Step 5: Run focused tests and typechecks GREEN**

Run: `pnpm vitest run tests/integration/module-registry.test.ts`

Run: `pnpm --filter @jarv1s/api typecheck && pnpm --filter @jarv1s/settings typecheck`

Expected: PASS.

- [ ] **Step 6: Commit task 4**

```bash
git add apps/api/src/external-module-jobs.ts apps/api/src/server.ts packages/settings/src/routes.ts packages/settings/src/routes-modules.ts packages/settings/src/me-account-routes.ts tests/integration/module-registry.test.ts
git commit -m "feat(api): enqueue external module runs safely" -m "Users can run eligible module jobs now, with activation, dedupe, and lifecycle reconciliation enforced." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: One server-only SSRF-safe pinned fetch implementation

**Files:**

- Create: `packages/host-fetch/src/index.ts`
- Modify: `packages/host-fetch/package.json`
- Modify: `packages/datasets/package.json`
- Modify: `packages/datasets/src/host-pinning.ts`
- Modify: `pnpm-lock.yaml`
- Test: `tests/unit/host-pinned-fetch.test.ts`

**Interfaces:**

- Consumes: Node `dns.promises.lookup`, `https.request`, `net.BlockList`, `URL`, `Headers`, and
  `Response`.
- Produces: `createHostPinnedFetch`, `HostPinnedFetchError`, and a browser-safe
  `@jarv1s/host-fetch/policy` export containing `assertValidFetchHosts`.

- [ ] **Step 1: Write adversarial failing transport tests**

With injected resolver/request ports, cover undeclared host, HTTP, port 8443, userinfo, IP literal,
private/loopback/link-local/CGNAT/metadata/multicast/reserved IPv4 and IPv6, mixed DNS answers where
one is blocked, host/hop-by-hop headers, redirect to undeclared/private/HTTP, header stripping on any
origin change, redirect limit, request timeout, request byte cap, streaming response over cap, and
successful pinning where connection address differs from SNI/Host hostname.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run tests/unit/host-pinned-fetch.test.ts`

Expected: FAIL because package and hardened implementation do not exist.

- [ ] **Step 3: Implement the standard-library transport**

Keep the existing hostname syntax validation in `src/policy.ts` free of `node:*` imports.
`createHostPinnedFetch` accepts allowed hosts and optional injected resolver/request hooks for tests.
For every hop: parse URL; reject userinfo/non-HTTPS/non-443/undeclared host; resolve all addresses;
reject the hop if any answer is non-global; choose a validated address; call `https.request` with
`hostname: address`, `servername: url.hostname`, and forced `Host: url.host`. Stream response chunks,
abort immediately over 5 MiB, and construct a bounded `Response`. Allow only GET/POST; reject body on
GET; cap decoded request bytes before sending.

Use stable typed codes only:

```ts
export type HostPinnedFetchErrorCode =
  | "host_not_declared"
  | "blocked_address"
  | "response_too_large"
  | "fetch_timeout"
  | "invalid_request";
```

- [ ] **Step 4: Repoint datasets without preserving duplicate logic**

Replace `packages/datasets/src/host-pinning.ts` with re-exports from `@jarv1s/host-fetch`, add the
workspace dependency, run `pnpm install --lockfile-only`, and keep the existing dataset API and
error classification green.

- [ ] **Step 5: Run focused tests and typechecks GREEN**

Run: `pnpm vitest run tests/unit/host-pinned-fetch.test.ts tests/unit/module-sdk-external-types.test.ts`

Run: `pnpm --filter @jarv1s/host-fetch typecheck && pnpm --filter @jarv1s/datasets typecheck`

Expected: PASS.

- [ ] **Step 6: Commit task 5**

```bash
git add packages/host-fetch/package.json packages/host-fetch/src/index.ts packages/datasets/package.json packages/datasets/src/host-pinning.ts pnpm-lock.yaml tests/unit/host-pinned-fetch.test.ts
git commit -m "feat(network): pin module fetches to safe hosts" -m "Outbound module and dataset requests now enforce global-address pinning and strict byte limits." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Expose `ctx.fetch` through the trusted parent

**Files:**

- Modify: `packages/module-sdk/src/worker.ts`
- Modify: `packages/module-registry/package.json`
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts`
- Modify: `packages/module-registry/src/external/worker-runtime.ts`
- Modify: `apps/api/src/external-module-tools.ts`
- Modify: `pnpm-lock.yaml`
- Test: `tests/unit/module-sdk-worker.test.ts`
- Test: `tests/unit/external-worker-runtime.test.ts`

**Interfaces:**

- Consumes: manifest `fetchHosts`, the shared pinned fetch transport, invocation secret tracker, and
  existing JSON-RPC runtime.
- Produces: child handler `fetch(request): Promise<ModuleFetchResponse>` backed by parent RPC method
  `fetch.request`.

- [ ] **Step 1: Write failing RPC and composition-guard tests**

Prove the child serializes the exact request DTO; parent rejects undeclared modules/hosts and
malformed methods/headers/body; response exposes only status, safe headers, and base64 body; no
provider/model/secret metadata crosses. Resolve a credential then prove any later RPC params
containing that exact secret reject before transport. Prove logs/results redact/reject secrets as
the current runtime already does.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run tests/unit/module-sdk-worker.test.ts tests/unit/external-worker-runtime.test.ts`

Expected: FAIL because `ctx.fetch` / `fetch.request` are absent.

- [ ] **Step 3: Add the child SDK method**

Extend the handler context with:

```ts
fetch(request: ModuleFetchRequest): Promise<ModuleFetchResponse>;
```

Implement it as one `callParent("fetch.request", request)` cast using the DTO declared in the
existing browser-safe module SDK. Do not expose native `Response` across JSON-RPC.

- [ ] **Step 4: Add the trusted parent RPC branch**

In `createExternalModuleRpcHandler`, handle `fetch.request` before KV scope parsing, validate exact
DTO keys/types, require manifest fetch hosts, call the pinned transport, stream/cap the body, and
project only a fixed response header allowlist such as `content-type`, `content-length`,
`last-modified`, and `etag`.

In `ExternalModuleWorkerRuntime.onStdout`, before dispatching a child-to-parent RPC, reject when
`containsSecret(message.params, invocation.secrets)` is true. Return only the fixed `rpc_failed`
wire error; never include a credential or URL/header value in logs.

- [ ] **Step 5: Run focused tests and typechecks GREEN**

Run: `pnpm vitest run tests/unit/module-sdk-worker.test.ts tests/unit/external-worker-runtime.test.ts`

Run: `pnpm --filter @jarv1s/module-sdk typecheck && pnpm --filter @jarv1s/module-registry typecheck && pnpm --filter @jarv1s/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit task 6**

```bash
git add packages/module-sdk/src/worker.ts packages/module-registry/package.json packages/module-registry/src/external/worker-rpc-host.ts packages/module-registry/src/external/worker-runtime.ts apps/api/src/external-module-tools.ts pnpm-lock.yaml tests/unit/module-sdk-worker.test.ts tests/unit/external-worker-runtime.test.ts
git commit -m "feat(modules): expose host-pinned fetch over worker RPC" -m "External worker handlers can fetch declared public hosts through the trusted parent." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: End-to-end security and regression gate

**Files:**

- Modify: `tests/integration/module-worker-rpc.test.ts`
- Modify: `tests/integration/module-registry.test.ts`
- Modify: `tests/integration/worker-lifecycle.test.ts`

**Interfaces:**

- Consumes: complete Goal #1 and Goal #3 implementation.
- Produces: fixture-module evidence for RLS scope, control reconciliation, idempotency, retries,
  schedule fan-out, run-now, and fetch trust boundaries.

- [ ] **Step 1: Add one external fixture worker exercising both goals**

Fixture declares two queues (one dead-letter), one per-user schedule, one manual queue, and one
fetch host. Its handler records only actor/resource ids into module KV and echoes its derived
idempotency key; it never embeds fetched/private content in a pg-boss payload.

- [ ] **Step 2: Add integration cases**

Cover fresh idempotency per occurrence, actor RLS isolation, schedule fan-out for multiple active
users, targeted disable/deactivate/delete removal, re-enable without duplicate registration,
running-worker control reconciliation, startup recovery after a dropped control message, package
hash/schema drift behavior, retry then dead-letter with unchanged metadata payload, run-now actor
binding/dedupe, and real parent-RPC fetch through injected safe transport.

- [ ] **Step 3: Run the complete requested gate**

Run: `pnpm verify:foundation`

Run: `pnpm test:integration`

Expected: both exit 0.

- [ ] **Step 4: Run explicit secrets/content spot checks**

Run: `rg -n '(prompt|content|secret|token|bodyBase64)' packages/jobs/src/module-jobs.ts packages/module-registry/src/external/job-reconciler.ts apps/worker/src/worker.ts`

Expected: only validator/error/type references; no payload or log field carries prompt text,
fetched content, credentials, tokens, or secret values.

- [ ] **Step 5: Sync the local knowledge graph**

Run: `codegraph sync .`

Expected: exit 0; `.codegraph/` remains untracked.

- [ ] **Step 6: Commit task 7**

```bash
git add tests/integration/module-worker-rpc.test.ts tests/integration/module-registry.test.ts tests/integration/worker-lifecycle.test.ts
git commit -m "test(modules): verify external worker trust boundaries" -m "No user-visible change; adds security and lifecycle regression coverage." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Self-Review

- Spec coverage: D1-D5 and D8 map to Tasks 1-4 and 7; D7 maps to Tasks 5-7. D6/Goal #2 is excluded.
- Metadata invariant: Task 2 snapshots the unchanged global allowlist and uses separate validators.
- RLS/security: Task 3 verifies the migration's role grants, owner, `search_path`, and bounded result.
- Lifecycle: startup, control queue, per-user changes, deactivation/deletion, drift, and orphan purge are
  covered. Persistent worker auto-disable and a new uninstall API remain explicit approval forks.
- Fetch: every requested initial/redirect trust boundary, streaming cap, pinning property, DTO, and
  credential-composition check maps to Tasks 5-7.
- Placeholder scan: no deferred implementation markers; every task names exact files, commands,
  expected outcomes, interfaces, and commit scope.
- Type consistency: `ModuleFetchRequest/Response` come from the browser-safe module SDK while the
  Node transport and pure hostname policy are split into explicit host-fetch package exports;
  `ExternalModuleJobPayload` and control payload remain in jobs; runtime and API reuse both.
