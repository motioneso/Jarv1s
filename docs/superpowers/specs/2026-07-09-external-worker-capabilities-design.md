# External worker capabilities — queue/schedule registration, structured-AI RPC, host-pinned fetch

**Status:** Draft — awaiting Ben approval
**Date:** 2026-07-09
**Owner:** Ben
**GitHub:** #915 (part of epic #860; unblocks #913 platform prerequisites 5, 6, and 7)
**Grounded on:** `origin/main` @ `204aca0f`, verified current before authoring

---

## Goal

Give externally installed module backend workers (per the approved #818 open-module-system spec)
three generic capabilities, all mediated by the trusted parent process:

1. **Queue/worker registration + schedule reconciliation** — a module's manifest declares pg-boss
   queues and recurring schedules; the platform registers workers that dispatch into the module's
   child process and reconciles per-user schedules on startup and enablement changes.
2. **Provider-agnostic structured-AI RPC** — `ctx.ai.generateStructured` for schema-validated
   structured output, routed through the existing AI capability router with user attribution and
   instance usage controls.
3. **Host-pinned outbound fetch** — `ctx.fetch` whose allowed hosts come from the module's declared
   manifest hosts, enforced in the trusted parent, upgrading `fetchHosts` from review-only
   documentation (#818 v1) to enforced policy for the capability path.

Generic contracts only: no consumer-specific queue names, prompts, or hosts enter core. The #913
job-search module is the first consumer but appears nowhere in this design.

## Current state (verified)

- `packages/jobs/src/pg-boss.ts` owns pg-boss client creation (`createPgBossClient`), queue
  migration (`migratePgBoss`), the enforced send wrapper (`sendJob`), the hard-coded
  `ALLOWED_PAYLOAD_KEYS` set with `assertMetadataOnlyPayload()`, and
  `registerDataContextWorker()`, which derives the RLS actor from `job.data.actorUserId` and runs
  each job inside `withDataContext`.
- `apps/worker/src/worker.ts` is the sole cron/supervise owner (`WORKER_BOSS_OPTIONS`); the API
  process never runs the schedule engine. Startup asserts every queue from
  `getAllQueueDefinitions()` exists, then registers foundation and built-in module workers.
- Recurring schedules follow the notes/briefings pattern: `boss.schedule(queue, cron, payload,
{ tz, key })` with one schedule row per actor, reconciled on settings change (any process may
  write the schedule row; only the worker executes cron). Reconcilers call
  `assertMetadataOnlyPayload` directly because `boss.schedule` bypasses `sendJob`.
- `JarvisModuleManifest.jobs` (`ModuleJobManifest`) exists but is declarative only; real wiring is
  imperative via `BuiltInModuleRegistration.queueDefinitions` + `registerWorkers`.
- `resolveModelForCapability(scopedDb, capability, tier)` in `packages/ai/src/repository.ts`
  routes capabilities (`"json"` included) through admin pins and `AiServiceBinding`
  (`mode|model`, #870 Slice 1). **The `"json"` capability is a routing label only** — no
  provider-agnostic "schema in, validated object out" execution API exists anywhere.
- `createHostPinnedFetch` (`packages/datasets/src/host-pinning.ts`) already implements exact-host
  allowlisting, https-only, bounded redirects with per-hop re-validation, sensitive-header
  stripping, and timeouts, driven by `ModuleExternalSourceManifest.fetchHosts`;
  `assertValidFetchHosts` validates manifest hosts (lowercase, no port, no IP literal). The
  separate `web.read` SSRF guard (`packages/web-research/src/url-safety.ts`) blocks
  private/loopback/link-local/CGNAT/metadata ranges against **DNS-resolved** addresses and pins
  the connection to the validated IP.
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
  readonly paramsSchema?: JsonSchema; // constrained; see D2
  readonly retryLimit?: number; // capped by platform config
  readonly deadLetterQueue?: string; // must be another declared queue of this module
}

interface ExternalModuleScheduleDeclaration {
  readonly id: string; // unique within the module
  readonly cron: string; // standard 5-field cron
  readonly tz?: string; // IANA zone; default UTC
  readonly queue: string; // must be a declared queue of this module
  readonly jobKind: string;
  readonly scope: "user"; // the only v1 scope
  readonly params?: Record<string, unknown>; // static, validated like any params (D2)
}
```

Loader validation (extends #818 Slice 1 rules, fail-closed):

- queue names and schedule ids must be module-id-prefixed / module-unique; collisions with
  foundation queues, built-in module queues, workflow queues, and other external modules' queues
  are rejected;
- `deadLetterQueue` must reference another declared queue of the same module (no cross-module
  dead-lettering, no undeclared queues);
- cron expressions parse as standard 5-field cron; invalid expressions reject the manifest;
- per-module caps: max queues and max schedules per module (platform config, small defaults);
- `retryLimit` is clamped to a platform maximum;
- `paramsSchema` must satisfy the D2 schema constraints at load time, not first use.

A declaration alone does nothing: queues are created and workers registered only while the module
is enabled (#818 `app.external_modules.status`), and schedules exist only for users with the
module active.

### D2. One platform envelope; params are schema-gated and bounded

Every external module job carries the same envelope, sent only through a new `sendModuleJob`
wrapper in `@jarv1s/jobs`:

```ts
interface ExternalModuleJobPayload {
  readonly actorUserId: string; // RLS actor; asserted UUID
  readonly moduleId: string;
  readonly jobKind: string;
  readonly idempotencyKey: string;
  readonly params?: Record<string, unknown>;
}
```

`ALLOWED_PAYLOAD_KEYS` gains the generic keys `moduleId`, `jobKind`, and `params` exactly once —
external modules can never extend the allowlist. Because the key allowlist cannot see inside
`params`, `sendModuleJob` adds layered content gates:

- `params` must validate against the queue's declared `paramsSchema`;
- the schema itself is constrained at manifest load: only `string` (with a mandatory `maxLength`
  ≤ 256), `number`, `integer`, `boolean`, `null`, enums of those, and flat objects/arrays of those
  to a maximum nesting depth of 2; no free-form unbounded strings;
- serialized `params` is hard-capped (2 KiB) and total payload capped (4 KiB);
- `assertMetadataOnlyPayload` still runs on the envelope.

Real state lives in module KV (#818) and module-owned tables (#914); params carry ids, kinds, and
short command flags, never content, prompts, or secrets. Schedule `params` templates pass the same
gates at manifest load and again at reconcile time.

### D3. Platform-registered workers dispatch into the module child process

For each enabled external module and each declared queue, `apps/worker` registers a
`registerDataContextWorker` whose handler:

1. re-checks enablement at delivery time — if the module is disabled or gone (hash-drift
   auto-disable, uninstall), the job completes as a no-op with a structured log line, not a retry;
2. resolves the queue's `handler` id and invokes the module's child process over the #818 Slice 3
   JSON-RPC runtime (same lazy spawn, per-module serialization, hard invocation timeout,
   crash-respawn, scrubbed env, bounded redacted stdio);
3. supplies the capability context: `ctx.auth` and `ctx.kv` (#818), `ctx.db` (#914 D5),
   `ctx.ai` (D6), `ctx.fetch` (D7), plus `{ actorUserId, jobKind, idempotencyKey, params }`.

The parent binds `module_id` and `actorUserId` from its own registration and the envelope — never
from worker input. Handlers receive no DB handle, VaultContext, root filesystem, or root env, and
must be idempotent per `idempotencyKey`.

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

where `envelope` is the D2 envelope with `actorUserId = userId` and the schedule's static
`params`, passed through `assertMetadataOnlyPayload` plus the D2 gates (as existing reconcilers
already do, since `boss.schedule` bypasses `sendJob`).

Reconciliation is derived state — manifest × enablement — with no new table:

- **Worker startup:** full pass. For every enabled external module, ensure schedules exist for
  every user with the module active; remove schedule rows (matched by key prefix) for modules or
  users no longer active, and orphaned rows for uninstalled modules.
- **Enablement changes:** admin enable/disable, per-user disable/re-enable, hash-drift
  auto-disable, and uninstall purge all trigger targeted reconcile in whatever process handled the
  change (schedule rows are plain DB writes; only the worker executes cron). Disable unschedules
  immediately — a disabled module goes quiet without waiting for delivery-time no-ops, which
  remain as the backstop.

The v1 cadence is fixed by the manifest cron. Per-user cadence preferences are module-internal
concerns (the handler may consult its KV config and no-op); dynamic per-user cron registration is
follow-on scope.

### D5. External queue lifecycle sits in reconciliation, not `db:migrate`

External module queues cannot join `migratePgBoss`'s static list — they appear at install time.
Instead:

- the worker-startup reconciliation pass (and module-enable handling) creates missing external
  queues via pg-boss queue creation **before** registering their workers;
- the startup queue-existence guard keeps asserting foundation/built-in/workflow queues exactly as
  today; external queues are _reconciled_, not asserted — a missing external queue is created, not
  fatal;
- disable leaves queues and queued jobs in place (delivery-time no-op per D3) so re-enable resumes
  cleanly; uninstall **purge** (#914 D6) deletes the module's schedule rows and drops its queues.

### D6. Structured AI: one generic seam in `packages/ai`, exposed over RPC

**The seam (usable by built-ins and core features, not worker-only):**

```ts
generateStructured(
  scopedDb: DataContextDb,
  input: {
    readonly service: string;          // e.g. "module.acme.jobsearch"
    readonly schema: JsonSchema;       // required output shape
    readonly prompt: string;
    readonly tierHint?: AiModelTier;   // default "economy" for module workers
  }
): Promise<
  | { ok: true; object: unknown; modelId: string; usage: AiUsageMetadata }
  | { ok: false; error: "needs_config" | "validation_failed" | "provider_error" }
>
```

- Model selection goes through `resolveModelForCapability(scopedDb, "json", tier)` — admin model
  pin, provider pin, and `AiServiceBinding` precedence all apply unchanged.
- The adapter layer invokes the resolved model with the provider-appropriate structured-output
  mechanism (native JSON-schema response format where supported, forced tool-call otherwise).
  Feature code never sees provider details.
- The platform validates the response against the JSON schema; on mismatch it performs a bounded
  repair loop (validation errors fed back, max 2 retries), then returns a typed
  `validation_failed` — never an unvalidated object.
- User attribution flows through `scopedDb`; usage lands in the existing AI audit path under the
  actor.

**Module exposure:** `ctx.ai.generateStructured({ schema, prompt, tier? })`. The parent:

- fixes `service` to `module.<moduleId>` — service bindings gain per-module keys with fallback to
  a generic module-worker binding, so admins can pin or re-tier any module's AI use;
- caps prompt bytes and schema bytes (platform config), and enforces per-module usage limits
  (calls per day, instance config) with a typed `usage_limited` error — an RPC-layer error the
  child sees alongside the seam's `needs_config` / `validation_failed` / `provider_error` union;
- passes no provider, model, or credential information into the child; AI credentials stay in the
  parent per the secrets invariant.

Prompts are module-authored trusted backend code (#818 trusted-operator mode); prompt text and
results never enter pg-boss payloads, logs, or KV writes made by the platform.

### D7. `ctx.fetch`: one pinned-fetch implementation, allowlist plus resolved-IP guard

`createHostPinnedFetch` is hoisted out of `packages/datasets` into a shared **server-only** home
(a small new package or the #818 module-host runtime package — build review picks the location;
`packages/shared` is browser-bundled and must stay free of `node:*`). `packages/datasets`
re-imports it; one implementation serves both the dataset connector path and `ctx.fetch`.

The hoisted helper is composed with the web-research SSRF machinery so `ctx.fetch` enforces, in
the trusted parent, per request **and per redirect hop**:

- https-only; exact-hostname match against the module's declared manifest `fetchHosts`
  (`assertValidFetchHosts` rules: lowercase, no port, no IP literals);
- DNS resolution with the private/loopback/link-local/CGNAT/metadata/reserved BlockList applied to
  the **resolved** addresses, and the connection pinned to the validated IP — a declared host that
  resolves (or rebinds) to `169.254.169.254`, RFC1918 space, or the Postgres host is refused;
- bounded redirects with sensitive-header stripping on cross-host hops;
- request timeout (default 15 s, clamped max), buffered response with a hard size cap (default
  5 MiB), and typed errors (`host_not_declared`, `blocked_address`, `response_too_large`,
  `fetch_timeout`).

The platform injects no credentials; a module that needs an API key reads its own declared
credential via `ctx.auth` and sets its own headers inside the handler. This upgrades `fetchHosts`
from #818's review-only documentation to enforced policy **for the capability path**. In
trusted-operator mode module code could still import `node:http` directly; `ctx.fetch` is the
sanctioned path and OS-level egress sandboxing remains the marketplace follow-on (#860 Phase 3).

LAN/private-host fetch is deliberately impossible in v1; a real module need would be an explicit
opt-in follow-on with its own review.

## Data model

**No new tables and no new migrations.** Schedule state lives in pg-boss's own schedule storage
(keyed rows, D4); queue existence is reconciled (D5); per-module AI limits and the
`module.<moduleId>` service bindings live in existing `app.instance_settings` keys. The
`foundation.test.ts` migration list is untouched. Nothing consumer-specific lands in core.

## Build slices

1. **Envelope + queue registration:** `sendModuleJob`, `ALLOWED_PAYLOAD_KEYS` additions, D2 gates,
   manifest `worker.queues` validation, worker registration dispatching into the child runtime
   with delivery-time enablement checks and dead-letter wiring.
2. **Schedule reconciliation:** manifest `worker.schedules` validation, per-user fan-out,
   startup + enablement-change reconcile, queue create/drop lifecycle (D5), uninstall purge hook.
3. **Structured-AI seam:** `generateStructured` in `packages/ai` (router, adapters, validation,
   repair loop, typed errors), per-service bindings for `module.<moduleId>`, then the `ctx.ai`
   RPC with caps and usage limits.
4. **Pinned fetch:** hoist `createHostPinnedFetch`, compose the resolved-IP guard and connection
   pinning, `ctx.fetch` RPC with caps and typed errors, datasets path re-pointed to the shared
   implementation.

Slice 3's `packages/ai` seam has no external-module dependency and may land first. Slices 1, 2,
and 4's RPC surfaces depend on the #818 Slice 3 child runtime; slice 1 also assumes #914's
`ctx.db` for anything beyond KV state.

## Non-goals

- No instance-scoped or system-actor schedules in v1 (`scope: "user"` only).
- No dynamic runtime schedule registration by modules (`ctx.schedule` RPC) — static manifest
  templates only.
- No workflow-layer (#819) integration: no graph retries, approvals, or step state for external
  module jobs in v1.
- No streaming, chat, vision, or transcription in `ctx.ai` v1 — structured output only.
- No provider or model selection by modules, ever.
- No OS/container egress sandboxing; `ctx.fetch` is policy for the capability path, not a network
  namespace (marketplace follow-on).
- No LAN/private-address fetch, even for declared hosts.
- No cross-module queues, dead-letter targets, or schedule keys.
- Nothing job-search-specific in core.

## Security and invariants

- **Metadata-only job payloads:** enforced in layers — key allowlist, schema-gated bounded
  `params` (load-time schema constraints + send-time validation + byte caps), and the same gates
  on schedule templates. Content, prompts, and secrets structurally cannot ride pg-boss.
- **Secrets never escape:** AI provider credentials stay in the parent; module credentials cross
  only the #818 JSON-RPC boundary; nothing credential-shaped enters payloads, schedules, logs, or
  AI prompts built by the platform.
- **No admin private-data bypass / private by default:** every scheduled or queued invocation is
  actor-scoped through `registerDataContextWorker` + `withDataContext`; RLS binds all module data
  access to the envelope's `actorUserId`, which the parent sets.
- **Provider-agnostic AI:** modules request structured output at a tier; router + admin bindings
  pick the model; typed `needs_config` when nothing is configured.
- **Module isolation:** queue names, schedule keys, dead-letter targets, service keys, and fetch
  hosts are all module-id-prefixed and validated; no cross-module reach.
- **Fail closed:** flag off, module disabled, hash drift, missing enablement row, or validation
  failure ⇒ no queues registered, schedules removed, delivery-time no-op backstop.
- **One cron owner:** only `apps/worker` runs the schedule engine; other processes only write
  schedule rows, exactly as today.

## Verification

- Unit: manifest `worker` validation — prefix and collision rejection (vs foundation, built-in,
  workflow, and other external queues), cron parse failures, per-module caps, `retryLimit` clamp,
  dead-letter target must be own declared queue, `paramsSchema` constraint enforcement (unbounded
  string rejected at load).
- Unit: `sendModuleJob` — schema validation, byte caps, allowlist interplay; oversized and
  free-text params rejected; envelope snapshot test proves no content keys.
- Integration (fixture module): scheduled job fires with the right `actorUserId` and RLS scope;
  per-user fan-out creates one schedule row per active user; per-user disable removes exactly that
  user's row; admin disable removes all and delivery-time no-op covers in-flight jobs; re-enable
  restores; uninstall purge drops schedules and queues.
- Integration: worker startup creates missing external queues before registration and still
  fail-fasts on missing built-in queues; startup reconcile removes orphaned schedule rows.
- Integration: handler failure retries per clamped `retryLimit` then lands on the declared
  dead-letter queue with the unchanged metadata-only payload.
- Integration: `generateStructured` returns a schema-valid object across at least two provider
  adapter shapes (native JSON schema + forced tool-call); invalid model output exhausts the repair
  loop into typed `validation_failed`; unconfigured instance yields `needs_config`; admin
  model/provider pins and `module.<id>` service bindings steer resolution; usage audit rows land
  under the actor; per-module usage limit returns `usage_limited`.
- Security: `ctx.ai` prompt/schema over caps rejected; RPC surface exposes no provider/model
  identifiers beyond the returned `modelId` metadata.
- Security: `ctx.fetch` — undeclared host, declared host resolving to private/loopback/metadata
  address, redirect to undeclared host, redirect to private address, http downgrade, oversized
  response, and timeout all fail typed; connection provably pinned to the validated IP; datasets
  connector path still green after the hoist.
- Security: job payloads and worker logs contain no prompt text, fetched content, or credential
  values (redaction spot checks).
- Gates: `pnpm verify:foundation` plus full `test:integration`; no `foundation.test.ts` migration
  list changes expected (no new migrations).

## Approval state

Draft. Interview decisions locked with Ben 2026-07-09: per-user schedule fan-out (D4), generic
structured-AI seam in `packages/ai` (D6), schema-gated bounded params (D2), allowlist plus
resolved-IP guard for fetch (D7). Awaiting Ben's review of this written spec.
