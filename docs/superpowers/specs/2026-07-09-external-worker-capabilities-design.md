# External worker capabilities — queue/schedule registration, structured-AI RPC, host-pinned fetch

**Status:** Draft (revision 2, post adversarial review) — awaiting Ben approval
**Date:** 2026-07-09
**Owner:** Ben
**GitHub:** #915 (part of epic #860; unblocks #913 platform prerequisites 5, 6, and 7)
**Grounded on:** `origin/main` @ `204aca0f`, verified current before authoring
**Review round:** revision 1 was adversarially reviewed by a second model (gpt-5.6-sol,
2026-07-09, verdict reject); every confirmed finding is incorporated below. Fork decisions from
that round (Ben): one new enumeration migration is accepted; durable AI usage quotas are deferred;
a minimal run-now enqueue seam is in v1 scope.

---

## Goal

Give externally installed module backend workers (per the approved #818 open-module-system spec)
three generic capabilities, all mediated by the trusted parent process:

1. **Queue/worker registration + schedule reconciliation** — a module's manifest declares pg-boss
   queues and recurring schedules; the platform registers workers that dispatch into the module's
   child process, reconciles per-user schedules on startup and enablement changes, and exposes a
   minimal authenticated run-now seam.
2. **Provider-agnostic structured-AI RPC** — `ctx.ai.generateStructured` for schema-validated
   structured output, routed through a service-aware extension of the AI capability router with
   user attribution and per-invocation resource caps.
3. **Host-pinned outbound fetch** — `ctx.fetch` with an explicit JSON wire contract whose allowed
   hosts come from the module's declared manifest hosts, enforced in the trusted parent, upgrading
   `fetchHosts` from review-only documentation (#818 v1) to enforced policy for the capability
   path.

Generic contracts only: no consumer-specific queue names, prompts, or hosts enter core. The #913
job-search module is the first consumer but appears nowhere in this design.

## Current state (verified)

- `packages/jobs/src/pg-boss.ts` owns pg-boss client creation (`createPgBossClient`), queue
  migration (`migratePgBoss`), the enforced send wrapper (`sendJob`), the hard-coded
  `ALLOWED_PAYLOAD_KEYS` set with `assertMetadataOnlyPayload()` — which validates **top-level keys
  only** — and `registerDataContextWorker()`, which derives the RLS actor from
  `job.data.actorUserId` and runs each job inside `withDataContext`.
- `apps/worker/src/worker.ts` is the sole cron/supervise owner (`WORKER_BOSS_OPTIONS`); the API
  process never runs the schedule engine. Startup asserts every queue from
  `getAllQueueDefinitions()` exists, then registers foundation and built-in module workers. Worker
  registration (`boss.work`) is **process-local**: a queue enabled while the worker is running has
  no handler until something tells the worker process.
- RLS on `app.users` gives `jarvis_worker_runtime` a **self-row-only** SELECT policy
  (`users_worker_runtime_select`, migration 0045). The worker cannot enumerate users; the only
  existing cross-user seam is the SECURITY DEFINER `app.count_all_users()` precedent from the same
  migration.
- Recurring schedules follow the notes/briefings pattern: `boss.schedule(queue, cron, payload,
{ tz, key })` with one schedule row per actor, reconciled on settings change (any process may
  write the schedule row; only the worker executes cron). Reconcilers call
  `assertMetadataOnlyPayload` directly because `boss.schedule` bypasses `sendJob`. Existing
  reconciliation is targeted per actor; there is no startup full pass today.
- `JarvisModuleManifest.jobs` (`ModuleJobManifest`) exists but is declarative only; real wiring is
  imperative via `BuiltInModuleRegistration.queueDefinitions` + `registerWorkers`.
- `resolveModelForCapability(scopedDb, capability, tier)` in `packages/ai/src/repository.ts`
  routes worker capabilities (`"json"` included) down the **automatic cross-provider branch**;
  service bindings (`AiServiceBinding`, #870) apply only to `USER_FACING_SERVICES`, and
  `setServiceBinding` rejects everything else. **No structured-output execution API exists
  anywhere**, and no per-module routing seam exists — both are built here.
- `createHostPinnedFetch` (`packages/datasets/src/host-pinning.ts`) implements exact-**hostname**
  allowlisting (ports are not compared), https-only, bounded redirects with per-hop hostname
  re-validation and hostname-change header stripping, and timeouts;
  `assertValidFetchHosts` validates manifest hosts (lowercase, no port, no IP literal). The
  separate `web.read` SSRF guard (`packages/web-research/src/url-safety.ts`) blocks
  private/loopback/link-local/CGNAT/metadata ranges against **DNS-resolved** addresses and pins
  the connection to the validated IP; its transport is GET-only and its BlockList does not cover
  multicast or other non-global ranges.
- #818 Slices 1–3 (#917/#918/#919) have not landed; this spec targets their approved contracts
  (external JSON manifests with handler ids, child-process JSON-RPC runtime, `ctx.auth`/`ctx.kv`),
  plus the #914 module-data-plane draft (`ctx.db`) and the approved-but-unlanded #819 workflow
  layer (which owns its own queues and is not touched here).

## Decisions

### D1. Manifest-declared queues and schedules, platform-validated

The external package schema (`ExternalJarvisModulePackage`, #818) gains a `worker` section:

```ts
interface ExternalModuleWorkerDeclaration {
  readonly queues?: readonly ExternalModuleQueueDeclaration[];
  readonly schedules?: readonly ExternalModuleScheduleDeclaration[];
}

interface ExternalModuleQueueDeclaration {
  readonly name: string; // module-id-prefixed, e.g. "acme.jobsearch.monitor"
  readonly handler: string; // handler id in the module worker bundle
  readonly paramsSchema?: ModuleParamsSchema; // constrained; see D2
  readonly retryLimit?: number; // capped by platform config
  readonly deadLetterQueue?: string; // must be another declared queue of this module
  readonly allowManualRun?: boolean; // opts the queue into the run-now seam (D8)
}

interface ExternalModuleScheduleDeclaration {
  readonly id: string; // unique within the module
  readonly cron: string; // standard 5-field cron
  readonly tz?: string; // IANA zone; default UTC
  readonly queue: string; // must be a declared queue of this module
  readonly jobKind: string; // bounded identifier (D2)
  readonly scope: "user"; // the only v1 scope
  readonly params?: Record<string, unknown>; // static, validated like any params (D2)
}
```

Loader validation (extends #818 Slice 1 rules, fail-closed):

- queue names and schedule ids must be module-id-prefixed / module-unique; collisions with
  foundation queues, built-in module queues, workflow queues, and other external modules' queues
  are rejected;
- `deadLetterQueue` must reference another declared queue of the same module (no cross-module
  dead-lettering, no undeclared queues), and the dead-letter graph must be acyclic — cycles reject
  the manifest at load;
- cron expressions parse as standard 5-field cron; invalid expressions reject the manifest;
- per-module caps: max queues and max schedules per module (platform config, small defaults);
- `retryLimit` is clamped to a platform maximum;
- `paramsSchema` must satisfy the D2 schema constraints at load time, not first use.

A declaration alone does nothing: queues are created and workers registered only while the module
is enabled (#818 `app.external_modules.status`), and schedules exist only for users with the
module active.

### D2. One platform envelope; a dedicated validator; params restricted to metadata formats

Every external module job carries the same envelope:

```ts
interface ExternalModuleJobPayload {
  readonly actorUserId: string; // RLS actor; set by the platform, never by callers (D3)
  readonly moduleId: string;
  readonly jobKind: string; // bounded identifier: /^[a-z][a-z0-9_.-]{0,63}$/
  readonly manifestHash: string; // enabled package hash at enqueue time (D3)
  readonly params?: Record<string, unknown>;
}
```

**The global `ALLOWED_PAYLOAD_KEYS` set and `assertMetadataOnlyPayload` are not touched.**
`assertMetadataOnlyPayload` validates top-level keys only, so adding a nested `params` key to the
global allowlist would let every existing `sendJob` caller smuggle arbitrary nested data. Instead,
module jobs get a dedicated validator, `assertModuleJobPayload(declaration, payload)`, enforced by
a new `sendModuleJob` wrapper and by the schedule reconciler (which bypasses `sendJob`, as
existing reconcilers do). Foundation jobs keep using `sendJob` unchanged; the two validators never
mix.

`params` content is restricted to **platform-defined metadata formats**, not arbitrary strings:

- `ModuleParamsSchema` fields may be: `uuid`, `identifier` (`/^[a-z0-9][a-z0-9_.:-]{0,63}$/i`),
  `timestamp` (ISO 8601), `integer` / `number` (with required min/max), `boolean`, `null`, or
  `enum` of declared identifier-format literals;
- flat objects and arrays of the above to a maximum nesting depth of 2, with a max field and
  element count;
- **no free-form string type exists** — a module cannot declare a field that carries prose,
  snippets, or secrets, no matter how short;
- serialized `params` is hard-capped (2 KiB) and the total payload capped (4 KiB).

Real state lives in module KV (#818) and module-owned tables (#914); params carry ids, kinds, and
short command flags. Schedule `params` templates pass the same gates at manifest load and again at
reconcile time.

**Idempotency** is not a payload field. The parent derives a per-occurrence idempotency key —
`{moduleId}:{jobKind}:{pg-boss job id}` — at delivery time and passes it to the handler. A static
template key would either dedupe away every recurrence or mean nothing; deriving it from the
pg-boss occurrence in the trusted parent makes it per-run and unforgeable. `sendModuleJob` callers
may additionally pass a `singletonKey` for enqueue-time dedupe (run-now double-click protection,
D8), which pg-boss enforces natively.

### D3. Platform-registered workers dispatch into the module child process

`sendModuleJob(access: AccessContext, declaration, { jobKind, params, singletonKey? })` binds
`actorUserId` from the authenticated `AccessContext` — never from caller-supplied data — and
stamps `moduleId` and the currently enabled `manifestHash` from the platform's own registry.

For each enabled external module and each declared queue, `apps/worker` registers a
`registerDataContextWorker` whose handler:

1. re-checks, at delivery time: module still enabled (hash-drift auto-disable, uninstall), the
   actor still exists and is active, and the module still active **for that actor**. Any miss
   completes the job as a structured-log no-op, not a retry;
2. compares the payload's `manifestHash` to the currently enabled package. On mismatch (the
   package was updated while jobs were queued), the job's `params` are re-validated against the
   **current** declaration: still valid → dispatch to the current handler; invalid → route to the
   module's dead-letter queue (or fail terminally without one) with a structured log. Queued jobs
   never execute against a contract they were not validated for;
3. resolves the queue's `handler` id and invokes the module's child process over the #818 Slice 3
   JSON-RPC runtime (same lazy spawn, per-module serialization, hard invocation timeout,
   crash-respawn, scrubbed env, bounded redacted stdio);
4. supplies the capability context: `ctx.auth` and `ctx.kv` (#818), `ctx.db` (#914 D5),
   `ctx.ai` (D6), `ctx.fetch` (D7), plus `{ actorUserId, jobKind, idempotencyKey, params }` with
   the parent-derived per-occurrence idempotency key (D2).

Handlers receive no DB handle, VaultContext, root filesystem, or root env, and must be idempotent
per the supplied `idempotencyKey`.

Failure semantics: a handler error or invocation timeout fails the pg-boss job; pg-boss transport
retry applies up to the queue's clamped `retryLimit`; exhausted retries land on the module's
declared dead-letter queue when present (payload unchanged and still metadata-only), otherwise the
job fails terminally. Workflow-style graph retry semantics (#819) are out of scope — these are
plain jobs.

### D4. Per-user schedule fan-out, reconciled from enablement

Schedules are **per-user fan-out**, mirroring the notes/briefings per-actor pattern: one pg-boss
schedule row per (module, schedule, active user):

```ts
boss.schedule(queue, cron, envelope, {
  tz,
  key: `${moduleId}:${scheduleId}:${userId}`
});
```

where `envelope` is the D2 envelope with `actorUserId = userId`, the schedule's static `params`,
and the manifest hash current at reconcile time, validated by `assertModuleJobPayload`.

Reconciliation is derived state — manifest × enablement — with no bespoke state table:

- **Worker startup:** full pass. For every enabled external module, ensure schedules exist for
  every user with the module active; remove rows (matched by key prefix) for modules, schedules,
  or users no longer active, and orphaned rows for uninstalled modules. Enumerating actors
  requires a narrow cross-user seam the worker's self-row RLS forbids today: **one new migration**
  adds a SECURITY DEFINER function (precedent: `app.count_all_users()`, migration 0045) that
  returns only `(user_id)` rows of active users with the given module active — metadata only,
  executable by `jarvis_worker_runtime`, definer role confined to exactly this read.
- **Enablement and lifecycle changes:** admin enable/disable, per-user disable/re-enable,
  hash-drift auto-disable, uninstall purge, **account deletion, and user deactivation** all
  trigger targeted reconcile in whatever process handled the change (schedule rows are plain DB
  writes; only the worker executes cron). Disable and deletion unschedule immediately; a failed
  reconcile write is retried and, as the backstop, corrected by the next startup full pass.
  Delivery-time re-checks (D3) cover the window in between — a deleted user's leftover schedule
  fires into a no-op, never into data access.
- **Worker-side registration on runtime changes:** `boss.work` registration is process-local, so
  enabling a module while the worker runs needs a worker-side signal. A metadata-only **platform
  control queue** (`platform.module-control`, a foundation queue in the static list) carries
  `{ moduleId, action: "reconcile" }` commands; the API enqueues one after any enablement change,
  and the worker's handler runs the targeted reconcile: create/update queues → register workers →
  write schedules, or the reverse (remove schedules → stop dispatch via the enablement check) on
  disable. Startup remains the full-pass backstop if a control message is lost.

The v1 cadence is fixed by the manifest cron. Per-user cadence preferences are module-internal
concerns (the handler may consult its KV config and no-op); dynamic per-user cron registration is
follow-on scope. The run-now seam (D8) covers on-demand execution.

### D5. External queue lifecycle: desired-state reconciliation in the worker

External module queues cannot join `migratePgBoss`'s static list — they appear at install time.
The worker's reconcile pass (startup and control-queue triggered) treats the manifest as desired
state:

- **create** missing declared queues in two passes — dead-letter targets first, then queues that
  reference them (the load-time acyclicity check makes two passes sufficient);
- **update** existing queues whose declared options (retry, dead-letter) changed, using the same
  createQueue-then-updateQueue convergence pattern `migratePgBoss` already uses;
- **remove** queues that a newly enabled package version no longer declares: `boss.offWork` first,
  then queue deletion, after in-flight jobs drain or dead-letter;
- **register exactly once**: re-enable must not double-register a handler in a live worker — the
  reconciler tracks its own registrations per module and tears them down before re-registering;
- **isolate failures per module**: a broken external module's reconcile failure is logged and
  auto-disables that module (fail closed); it never prevents foundation or built-in worker
  registration from completing.

The startup queue-existence guard keeps asserting foundation/built-in/workflow queues exactly as
today (including the new `platform.module-control` queue); external queues are _reconciled_, not
asserted. Disable leaves queues and queued jobs in place (delivery-time no-op per D3) so re-enable
resumes cleanly; uninstall **purge** (#914 D6) deletes the module's schedule rows, stops workers,
and drops its queues.

### D6. Structured AI: a service-aware seam in `packages/ai`, exposed over RPC

**Routing seam.** Today's `resolveModelForCapability` routes worker capabilities down the
automatic branch and its service bindings are restricted to `USER_FACING_SERVICES` — per-module
routing does not exist and is built here, not assumed. A new resolution entry point,
`resolveModelForService(scopedDb, service, { capability: "json", tierHint })`, defines the
precedence explicitly:

1. admin model pin, then admin provider pin (unchanged, as in every existing branch);
2. a binding for the exact service key `module.<moduleId>`;
3. the generic `module.worker` default binding;
4. the automatic worker-capability branch (`selectAutomaticModelForCapability`) as the fallback.

`module.<moduleId>` keys are a validated dynamic namespace: the admin binding API accepts
`module.` keys only for currently installed modules, and uninstall purge removes the module's
binding. `setServiceBinding`'s `USER_FACING_SERVICES` gate is widened to admit exactly this
namespace, nothing else.

**Execution seam** (usable by built-ins and core features, not worker-only):

```ts
generateStructured(
  scopedDb: DataContextDb,
  input: {
    readonly service: string;          // e.g. "module.acme.jobsearch"
    readonly schema: JsonSchema;       // required output shape; bounded, see below
    readonly prompt: string;
    readonly tierHint?: AiModelTier;   // default "economy" for module workers
    readonly signal?: AbortSignal;     // cancellation propagates to the provider call
  }
): Promise<
  | { ok: true; object: unknown; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; error: "needs_config" | "validation_failed" | "provider_error" | "aborted" }
>
```

- The adapter layer invokes the resolved model with the provider-appropriate structured-output
  mechanism (native JSON-schema response format where supported, forced tool-call otherwise).
  Feature code never sees provider details.
- The platform validates the response against the JSON schema; on mismatch it performs a bounded
  repair loop (validation errors fed back, max 2 retries), then returns a typed
  `validation_failed` — never an unvalidated object. Every repair attempt counts against the
  caller's per-invocation call cap, and one overall deadline covers the whole loop.
- Resource bounds on inputs, enforced before any provider call: prompt bytes, schema bytes,
  schema nesting depth, no `$ref` (self-referential schemas rejected), bounded
  combinator/property counts, no regex `pattern` keywords, an output-token cap passed to the
  provider, and a serialized-result byte cap.
- User attribution flows through `scopedDb`; token usage is recorded parent-side against the
  actor and service via the existing AI usage logging path. The resolved model id stays in
  parent-side logs/audit — it is **not** returned to module callers (see below).

**Module exposure:** `ctx.ai.generateStructured({ schema, prompt, tier? })`. The parent:

- fixes `service` to `module.<moduleId>`; the child cannot choose a service, provider, or model,
  and the RPC result omits the model id entirely — the child sees `{ object, usage }` or a typed
  error (`needs_config | validation_failed | provider_error | usage_limited | aborted`, where
  `usage_limited` is the RPC layer's per-invocation cap);
- enforces a **per-invocation call cap** (max `generateStructured` calls per job invocation,
  platform config, repair attempts included) — enforced in parent memory, no storage needed.
  Durable per-module daily quotas are follow-on scope (see Non-goals);
- ties the RPC deadline to the job invocation's hard timeout: when the invocation is killed, the
  in-flight provider call is aborted via the seam's `AbortSignal` — no orphaned paid AI work;
- passes no provider, model, or credential information into the child; AI credentials stay in the
  parent per the secrets invariant.

**Credential/prompt composition guard.** The same handler holds `ctx.auth` and `ctx.ai`, so
module code _could_ paste a fetched credential into a prompt. The parent mitigates: it keeps the
set of credential values resolved via `ctx.auth` during the current invocation and rejects any
`ctx.ai` (or `ctx.fetch` body) input containing one of them, with a typed error. This is a
guardrail against accidental leakage, not a sandbox — a determined module in trusted-operator
mode can transform a secret past substring checks, and the spec states that residual risk
honestly rather than claiming the invariant holds unconditionally against malicious module code.
Full mitigation is the marketplace review + sandbox track (#860 Phase 3).

Prompts are module-authored trusted backend code (#818 trusted-operator mode); prompt text and
results never enter pg-boss payloads, logs, or KV writes made by the platform.

### D7. `ctx.fetch`: one pinned-fetch implementation, explicit wire contract, hardened SSRF guard

`createHostPinnedFetch` is hoisted out of `packages/datasets` into a shared **server-only** home
(a small new package or the #818 module-host runtime package — build review picks the location;
`packages/shared` is browser-bundled and must stay free of `node:*`). `packages/datasets`
re-imports it; one implementation serves both the dataset connector path and `ctx.fetch`.

**Wire contract.** A native `Response` cannot cross JSON-RPC, so `ctx.fetch` has explicit DTOs:

```ts
interface ModuleFetchRequest {
  readonly url: string;
  readonly method?: "GET" | "POST"; // default GET; v1 supports exactly these
  readonly headers?: Record<string, string>; // end-to-end headers only; see below
  readonly bodyBase64?: string; // POST only; request byte cap enforced pre-send
}

interface ModuleFetchResponse {
  readonly status: number;
  readonly headers: Record<string, string>; // projected safe subset (content-type, etc.)
  readonly bodyBase64: string; // capped; over-cap requests fail, never truncate
}
```

The response body is size-checked **while streaming** — the parent aborts the connection the
moment the cap (default 5 MiB, platform config) is exceeded and returns `response_too_large`; it
never buffers unbounded data first.

**Per request and per redirect hop**, enforced in the trusted parent:

- https-only, **port 443 only** in v1 (the current helper compares `url.hostname`, which ignores
  ports — `https://example.com:8443` must not ride an `example.com` declaration);
- URLs with userinfo (`user:pass@host`) are rejected outright;
- exact-hostname match against the module's declared manifest `fetchHosts`
  (`assertValidFetchHosts` rules: lowercase, no port, no IP literals);
- DNS resolution with a denylist requiring **globally routable unicast** resolved addresses —
  private, loopback, link-local, CGNAT, metadata, multicast, broadcast, and reserved ranges are
  all refused (the existing web-research BlockList is extended to cover the non-global ranges it
  misses today, e.g. `224.0.0.0/4`, `ff00::/8`) — and the connection pinned to the validated IP
  with TLS SNI and the `Host` header forced from the validated URL;
- caller headers: hop-by-hop headers (`Connection`, `Transfer-Encoding`, `Upgrade`, …) and
  `Host` are rejected; remaining headers pass through, and **all caller headers are stripped when
  a redirect leaves the original origin** — compared as full origin (scheme + host + port), not
  hostname, so a same-host port change also strips;
- bounded redirects, request timeout (default 15 s, clamped max), and typed errors
  (`host_not_declared`, `blocked_address`, `response_too_large`, `fetch_timeout`,
  `invalid_request`).

The platform injects no credentials; a module that needs an API key reads its own declared
credential via `ctx.auth` and sets its own headers inside the handler (subject to the D6
composition guard for platform-visible values). This upgrades `fetchHosts` from #818's
review-only documentation to enforced policy **for the capability path**. In trusted-operator
mode module code could still import `node:http` directly; `ctx.fetch` is the sanctioned path and
OS-level egress sandboxing remains the marketplace follow-on (#860 Phase 3).

LAN/private-host fetch is deliberately impossible in v1; a real module need would be an explicit
opt-in follow-on with its own review.

### D8. Run-now: a minimal authenticated enqueue seam

#913-class modules need "run it now" during onboarding and verification, and module children have
no `sendModuleJob`. v1 adds one host-side route:

```
POST /api/modules/:moduleId/queues/:queueName/run   { jobKind, params? }
```

- available only for queues declared with `allowManualRun: true`;
- the actor comes from the authenticated session's `AccessContext`; the route enqueues via
  `sendModuleJob`, so every D2/D3 gate applies unchanged;
- requires the module to be enabled for the calling user; per-user + per-module rate-limited
  (platform config), with a pg-boss `singletonKey` (`manual:{moduleId}:{queueName}:{userId}`) so
  a double-click cannot stack duplicate runs while one is queued;
- responds with the job id only — no job output flows back through this route; results land
  wherever the handler writes them (module tables/KV), like any scheduled run.

Module web surfaces and assistant tools call it like any other host API. A `ctx.jobs.enqueue` RPC
for child-initiated enqueue is deliberately **not** in v1 — scheduled runs and user-initiated
runs cover the declared scope, and child-initiated fan-out wants its own review (loop risk).

## Data model

**One new migration**, nothing else:

- a SECURITY DEFINER enumeration function (D4) returning `(user_id)` for active users with a
  given module active — metadata only, `jarvis_worker_runtime`-executable, definer confined to
  exactly this read. The `foundation.test.ts` migration list gains this one row (the full
  migration list is asserted with `toEqual` — the row must be added and the full
  `test:integration` suite run, per the known trap).

No other tables or migrations. Schedule state lives in pg-boss's own schedule storage (keyed
rows, D4); queue existence is reconciled (D5); per-module AI bindings and platform caps live in
existing `app.instance_settings` keys; per-invocation AI call caps are parent-memory only.
Nothing consumer-specific lands in core.

## Build slices

1. **Envelope + queue registration:** `assertModuleJobPayload` + `sendModuleJob` (global
   allowlist untouched), manifest `worker.queues` validation (formats, acyclic dead-letter,
   caps), worker registration dispatching into the child runtime with delivery-time enablement +
   manifest-hash checks, per-occurrence idempotency, dead-letter wiring, per-module reconcile
   failure isolation.
2. **Schedules + control plane:** the enumeration migration, manifest `worker.schedules`
   validation, per-user fan-out, startup full pass, `platform.module-control` queue + targeted
   reconcile on enablement/lifecycle changes, desired-state queue reconciliation (D5), uninstall
   purge hook, run-now route (D8).
3. **Structured-AI seam:** `resolveModelForService` + `module.*` binding namespace,
   `generateStructured` (adapters, validation, repair loop, resource bounds, abort propagation,
   typed errors), then the `ctx.ai` RPC with per-invocation caps and the composition guard.
4. **Pinned fetch:** hoist `createHostPinnedFetch`, port/origin/userinfo/header hardening,
   extended non-global-address denylist with connection pinning, streaming size cap, the
   `ctx.fetch` DTOs and RPC, datasets path re-pointed to the shared implementation.

Slice 3's `packages/ai` seam has no external-module dependency and may land first. Slices 1, 2,
and 4's RPC surfaces depend on the #818 Slice 3 child runtime; slice 1 also assumes #914's
`ctx.db` for anything beyond KV state.

## Non-goals

- No instance-scoped or system-actor schedules in v1 (`scope: "user"` only).
- No dynamic runtime schedule registration by modules and no per-user cron configuration —
  static manifest templates plus the run-now seam only.
- No `ctx.jobs.enqueue` (child-initiated enqueue) in v1.
- No durable per-module AI usage quotas (calls/tokens per day) in v1 — per-invocation caps only;
  a durable usage ledger is follow-on scope with its own storage design.
- No workflow-layer (#819) integration: no graph retries, approvals, or step state for external
  module jobs in v1.
- No streaming, chat, vision, or transcription in `ctx.ai` v1 — structured output only.
- No provider or model selection by modules, ever.
- No OS/container egress sandboxing; `ctx.fetch` is policy for the capability path, not a network
  namespace (marketplace follow-on).
- No LAN/private-address fetch and no non-443 ports, even for declared hosts.
- No cross-module queues, dead-letter targets, or schedule keys.
- Nothing job-search-specific in core.

## Security and invariants

- **Metadata-only job payloads:** the global `ALLOWED_PAYLOAD_KEYS` / `assertMetadataOnlyPayload`
  pair is untouched; module envelopes get their own validator with format-restricted fields — no
  free-form string type exists in `ModuleParamsSchema`, so prose, snippets, and secrets are
  structurally unrepresentable, on top of byte caps.
- **Actor authority:** `sendModuleJob` binds the actor from an authenticated `AccessContext`;
  delivery re-verifies user existence and per-user module activation; the per-occurrence
  idempotency key is parent-derived. Nothing actor-shaped is trusted from caller or child input.
- **Secrets never escape:** AI provider credentials stay in the parent; module credentials cross
  only the #818 JSON-RPC boundary; the composition guard rejects platform-resolved credential
  values appearing in `ctx.ai`/`ctx.fetch` inputs, with the residual trusted-code risk stated
  honestly (D6).
- **No admin private-data bypass / private by default:** every scheduled, queued, or run-now
  invocation is actor-scoped through `registerDataContextWorker` + `withDataContext`; the new
  enumeration function returns user ids only and is confined to its single read.
- **Provider-agnostic AI:** modules request structured output at a tier; the service-aware
  resolver and admin bindings pick the model; typed `needs_config` when nothing is configured;
  no model identity crosses to the child.
- **Module isolation:** queue names, schedule keys, dead-letter targets, `module.*` binding keys,
  and fetch hosts are all module-id-prefixed and validated; no cross-module reach; a failing
  module is auto-disabled without disturbing others.
- **Fail closed:** flag off, module disabled, hash drift, missing enablement row, manifest-hash
  mismatch with invalid params, or validation failure ⇒ no registration, schedules removed,
  dead-letter or no-op — never execution against unvalidated input.
- **One cron owner:** only `apps/worker` runs the schedule engine and registers handlers; other
  processes write schedule rows and enqueue control messages only.

## Verification

- Unit: manifest `worker` validation — prefix and collision rejection (vs foundation, built-in,
  workflow, and other external queues), cron parse failures, per-module caps, `retryLimit` clamp,
  dead-letter target must be own declared queue, dead-letter cycle rejection,
  `ModuleParamsSchema` constraint enforcement (free-form string type rejected at load; formats
  enforced).
- Unit: `assertModuleJobPayload` — format validation, byte caps, envelope snapshot test proving
  no content-bearing keys; global `assertMetadataOnlyPayload` provably unchanged (no `params`
  key admitted).
- Integration (fixture module): scheduled job fires with the right `actorUserId` and RLS scope
  and a fresh per-occurrence idempotency key each run; per-user fan-out creates one schedule row
  per active user via the enumeration function; per-user disable removes exactly that user's row;
  admin disable removes all and delivery-time no-op covers in-flight jobs; account deletion
  unschedules; re-enable restores without double-registering handlers; uninstall purge drops
  schedules, workers, queues, and `module.*` bindings.
- Integration: control-queue reconcile — enabling a module against a **running** worker creates
  queues and registers workers without a restart; a dropped control message is corrected by the
  next startup pass; a broken external module auto-disables without blocking built-in worker
  startup.
- Integration: package update with queued jobs — matching-hash jobs dispatch; changed-schema jobs
  re-validate and dead-letter when incompatible; handler failure retries per clamped `retryLimit`
  then lands on the declared dead-letter queue with the unchanged payload.
- Integration: run-now route — rejects queues without `allowManualRun`, rejects users without
  the module active, applies rate limit and `singletonKey` dedupe, enqueues with the session
  actor.
- Integration: `generateStructured` returns a schema-valid object across at least two provider
  adapter shapes (native JSON schema + forced tool-call); invalid model output exhausts the
  repair loop into typed `validation_failed`; unconfigured instance yields `needs_config`; admin
  pins > `module.<id>` binding > `module.worker` binding > automatic branch precedence verified;
  uninstalled-module binding keys rejected by the admin API; usage recorded under the actor;
  per-invocation call cap returns `usage_limited` with repair attempts counted; invocation kill
  aborts the in-flight provider call.
- Security: `ctx.ai`/`ctx.fetch` inputs containing a credential value resolved via `ctx.auth`
  this invocation are rejected typed; prompt/schema over caps, over-deep or `$ref` schemas
  rejected; RPC result contains no model or provider identifiers.
- Security: `ctx.fetch` — undeclared host, non-443 port, userinfo URL, hop-by-hop or `Host`
  header, declared host resolving to private/loopback/metadata/multicast address, redirect to
  undeclared host, redirect to private address, cross-origin redirect retaining headers
  (must strip, including same-host port change), http downgrade, streaming over-cap response,
  and timeout all fail typed; connection provably pinned to the validated IP with forced SNI;
  datasets connector path still green after the hoist.
- Security: job payloads and worker logs contain no prompt text, fetched content, or credential
  values (redaction spot checks).
- Gates: `pnpm verify:foundation` plus full `test:integration` (mandatory — the migration list
  assertion in `foundation.test.ts` changes with the new enumeration migration).

## Approval state

Draft, revision 2. Interview decisions locked with Ben 2026-07-09: per-user schedule fan-out
(D4), generic structured-AI seam in `packages/ai` (D6), format-restricted bounded params (D2),
allowlist plus resolved-IP guard for fetch (D7). Adversarial second-model review round completed
2026-07-09 (gpt-5.6-sol, verdict reject on revision 1); all confirmed findings incorporated in
this revision, with Ben's fork decisions: accept one enumeration migration + defer durable AI
quotas; add the D8 run-now seam. Awaiting Ben's review of this revision.
