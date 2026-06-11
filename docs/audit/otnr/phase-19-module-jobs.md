## Phase 19 — Module jobs

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 1
- MED: 3
- LOW: 2
- INFO: 2

### Findings

#### [HIGH] Metadata-only payload invariant is unenforced — only a marker base interface, no type-level or runtime guard
**File:** `packages/jobs/src/pg-boss.ts:14-20,84-98`  
**Invariant violated / concern:** Hard invariant #6 (Metadata-only job payloads) and #5 (Secrets never escape into pg-boss payloads).  
**Detail:** `ActorScopedJobPayload` only requires `actorUserId`. Any module can declare `interface FooPayload extends ActorScopedJobPayload { messageBody: string; secret: string }` and `registerDataContextWorker<FooPayload, ...>` / `boss.send(...)` will happily accept it. There is no structural constraint preventing arbitrary content (and the generic `TPayload extends ActorScopedJobPayload` does nothing to bound the *additional* fields), and no runtime check on `boss.send` payloads. The metadata-only rule is currently enforced only by a single integration test asserting one queue's payload shape (`foundation.test.ts:311`) plus reviewer vigilance — exactly the "convention, not a mechanism" failure mode that the security memory warns against. This is the module that owns the pg-boss boundary; the guard belongs here.  
**Suggested fix:** Provide a constrained payload contract and a single chokepoint. Add a branded `JobPayload` type whose extra fields are restricted to primitive ID/scalar shapes, and expose a `sendJob(boss, queue, payload)` wrapper (used instead of raw `boss.send`) that, at minimum in dev/test, runs a shallow assertion that every value is a string/number/boolean/short id (reject objects, arrays of objects, long strings over a threshold). At the type level, consider `type MetadataValue = string | number | boolean` and `Record<string, MetadataValue>` bounds. This makes invariant #6 a mechanism rather than a habit.

#### [MED] `boss.on("error", (error) => { throw error })` re-throws inside an EventEmitter listener — crashes the process / unhandled rejection
**File:** `packages/jobs/src/pg-boss.ts:52-54`  
**Invariant violated / concern:** Code quality / error handling — over-clever handler that converts a recoverable observability hook into an uncatchable crash.  
**Detail:** pg-boss emits `error` asynchronously from internal maintenance/supervision/connection paths. Throwing synchronously inside that listener does not propagate to any caller of `createPgBossClient`; it escapes the `emit()` call inside the library and becomes an uncaught exception, taking down the worker/API process on a transient DB blip rather than logging and letting pg-boss's retry machinery recover. It also silently discards the error (no log, no metric) before crashing, so the operator gets a bare stack with no context. Every consumer (`chat`, `tasks`, `briefings`) inherits this.  
**Suggested fix:** Replace with a real observability hook: accept an optional `onError?: (error: Error) => void` in the options and default it to a structured logger call (`logger.error({ err }, "pg-boss error")`). Do not re-throw from the listener.

#### [MED] No cancellation / job-query surface is scoped to `actorUserId` — module leaves IDOR risk to every consumer
**File:** `packages/jobs/src/pg-boss.ts` (whole module; absence of a scoped accessor)  
**Invariant violated / concern:** Hard invariant #2 (Private by default) / IDOR — cancellation and job-status reads are not actor-scoped at the module boundary.  
**Detail:** The module exposes worker registration and (via re-export of the raw `PgBoss`) the unguarded `boss.cancel(queue, id)`, `boss.getJobById(queue, id)`, `boss.deleteJob(...)` surface. pgboss tables are not RLS-protected (the foundation test deliberately keeps `actorUserId` *inside* the payload, not as a DB-enforced row owner). So any code holding the `boss` handle can cancel or read *another user's* job by id with no ownership check, and nothing in this module forces callers to filter by `job.data.actorUserId`. Today consumers happen not to expose cancellation to end users, but the boundary that owns pg-boss provides no safe primitive, so the first feature that adds "cancel my briefing" will reach for raw `boss.cancel` and ship an IDOR.  
**Suggested fix:** Add an actor-scoped helper, e.g. `cancelOwnedJob(boss, queue, jobId, actorUserId)` that fetches the job, verifies `job.data.actorUserId === actorUserId` before cancelling/deleting, and a `getOwnedJob` that returns `null` on mismatch. Document that raw `boss.cancel`/`getJobById` must not be used with a client-supplied id.

#### [MED] `boss.getQueue` → `updateQueue`/`createQueue` migration loop is non-atomic and racy across concurrent migrators
**File:** `packages/jobs/src/pg-boss.ts:59-82`  
**Invariant violated / concern:** Code quality / concurrency — check-then-act TOCTOU; non-atomic multi-step setup.  
**Detail:** `migratePgBoss` does a read (`getQueue`) then a conditional write (`createQueue` vs `updateQueue`) per queue. If two migrator processes run concurrently (the fleet runs multiple agents and `db:migrate` is described as idempotent and re-runnable), both can observe `existing === undefined` and both call `createQueue`, racing on a duplicate-create error that aborts the whole migration. The loop is also sequential per-queue for no ordering reason. Because each consumer module ships its own queue list and the runner is meant to be idempotent, the check-then-act gap is a real concurrency hazard, not theoretical.  
**Suggested fix:** Make the per-queue step idempotent and order-independent: call `createQueue` and treat an already-exists error as "then updateQueue", or use a single upsert-style path if pg-boss exposes one (`createQueue` is a no-op if it exists in recent pg-boss; verify against the pinned `^12.18.2`). At minimum wrap the create in a try/catch that falls through to `updateQueue` on conflict so concurrent runners converge instead of crashing.

#### [LOW] `migratePgBoss` ignores caller-supplied `ConstructorOptions` — silent divergence from `createPgBossClient`
**File:** `packages/jobs/src/pg-boss.ts:59-67`  
**Invariant violated / concern:** Code quality — duplicated/forked construction path that can drift.  
**Detail:** `createPgBossClient` accepts `overrides` and installs the error listener; `migratePgBoss` builds its own client inline with only `{ migrate: true, createSchema: true }` and no way to pass connection overrides (pool size, ssl, application_name). The two construction sites can drift (e.g. the error-listener change above would need to be made twice), and there is no single source of truth for client construction.  
**Suggested fix:** Have `migratePgBoss` call `createPgBossClient(connectionString, { migrate: true, createSchema: true, ...overrides })` so there is one construction path.

#### [LOW] `if (!job.data.actorUserId)` truthiness guard accepts/rejects on emptiness, not on a real validation contract
**File:** `packages/jobs/src/pg-boss.ts:100-108`  
**Invariant violated / concern:** Error handling / TypeScript — boundary validation done by truthiness on a typed-but-untrusted payload.  
**Detail:** pg-boss payloads are deserialized JSON; the `Job<TPayload>` type is an unchecked cast over whatever was stored. A payload with `actorUserId` present but not a UUID (or a number coerced to a weird string) passes the `!` check and flows straight into `withDataContext` → `set_config('app.actor_user_id', ...)`, where it becomes the RLS actor. The truthiness check is the only validation at the trust boundary between stored JSON and the RLS context.  
**Suggested fix:** Validate shape, not just presence — assert `typeof job.data.actorUserId === "string"` and that it matches the expected id format (uuid regex or a shared `assertUserId`) before constructing the `AccessContext`. This is the one place untrusted stored data becomes the security principal, so it warrants a real guard.

#### [INFO] `registerDataContextWorker` per-job transaction wrapping is clean and correct
**File:** `packages/jobs/src/pg-boss.ts:84-98`  
**Invariant violated / concern:** None — positive note.  
**Detail:** Batches are handled as single-job (`[job]`), each job runs inside `dataContext.withDataContext(...)`, which opens a transaction and sets `app.actor_user_id` for RLS before the handler runs. This correctly threads the actor into the RLS context per job and matches invariant #3 (DataContextDb only — the handler receives the branded `scopedDb`, never the root Kysely). `requestId` is derived as `pgboss:${job.id}`, giving traceability without leaking payload content. Reviewed and sound.  
**Foundation queue retention** (`deleteAfterSeconds`/`retentionSeconds` on the probe queue, `retryLimit: 0`) is appropriately tight.

#### [INFO] No `sql/` directory; grants live outside this package — confirmed by design
**File:** `packages/jobs/` (no `sql/` dir)  
**Invariant violated / concern:** None — orientation note for invariant #11.  
**Detail:** `packages/jobs` ships no migrations or SQL; pg-boss schema creation is delegated to the library via `migrate: true/createSchema: true` in `migratePgBoss`, and runtime role grants on the `pgboss` schema are applied by the migration runner's grants step (per CLAUDE.md `pnpm db:migrate` ordering). The `foundation.test.ts:283` test confirms the runtime app role runs pg-boss clients *without* migration privileges, so the least-privilege split is verified elsewhere. Nothing in this module violates invariant #11; flagging only so the next reviewer doesn't expect a `sql/` dir here.
