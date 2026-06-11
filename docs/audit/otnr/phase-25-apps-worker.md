## Phase 25 — apps/worker (pg-boss worker)

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 0
- MED: 3
- LOW: 4
- INFO: 3

### Findings

`apps/worker/src` contains a single 72-line entrypoint (`worker.ts`). It owns no handler
business logic — every handler is registered through `@jarv1s/jobs`
(`registerDataContextWorker`) and `@jarv1s/module-registry` (`registerBuiltInModuleWorkers`),
which dispatch into the module packages (`@jarv1s/tasks`, `@jarv1s/chat`, `@jarv1s/briefings`).
Those module job bodies are out of this phase's scope and are audited in their own phases.
Findings below are scoped to what `worker.ts` owns or directly relies on for the audit's
security/correctness questions (actor validation, payload validation, dead-letter exposure,
transactionality, shared state, least-privilege grants, resource leaks).

The good news up front (verified, not assumed):
- The worker connects as `jarvis_worker_runtime`, which is created `NOBYPASSRLS` and granted only
  `USAGE`/`SELECT`/`EXECUTE` on a narrow surface (`infra/postgres/bootstrap/0000_roles.sql:16`,
  `infra/postgres/migrations/0001_app_schema.sql:72-73`,
  `infra/postgres/migrations/0002_app_rls.sql:90-93`). No admin/RLS-bypass — Hard Invariant 1 holds,
  and it is regression-tested (`tests/integration/foundation.test.ts:176`).
- Every job runs inside `DataContextRunner.withDataContext`, which opens ONE transaction, sets
  `app.actor_user_id`/`app.request_id` via parameterized `set_config` (no injection;
  `packages/db/src/data-context.ts:30-38,62-68`), and derives the actor strictly from the job
  payload's `actorUserId` after a presence check (`packages/jobs/src/pg-boss.ts:100-109`). Handlers
  receive only the branded `DataContextDb`, never the root Kysely — Hard Invariants 3 and 4 hold.

#### [MED] Normal shutdown abandons in-flight jobs mid-execution (`graceful: false`)
**File:** `apps/worker/src/worker.ts:41`  
**Invariant violated / concern:** Quality bar — "non-atomic multi-step updates that can leave half-applied state" / unnecessarily abrupt orchestration.  
**Detail:** `shutdown()` calls `boss.stop({ graceful: false })` on BOTH `SIGINT` and `SIGTERM` (lines 41, 44-50). `SIGTERM` is the normal signal a process manager / `docker stop` / deploy sends. `graceful: false` tells pg-boss not to wait for active handlers to finish — it tears the worker down immediately and `workerDb.destroy()` (also in the same `Promise.allSettled`) races to close the pool out from under any handler still mid-transaction. Each individual job IS transactional (so the DB write is atomic and rolls back), but a multi-step job that performs side effects across steps — or simply a long embedding/AI job — is killed and left to redelivery, which is wasted work and, for non-idempotent external effects, a partial-effect risk. The API server's `graceful: false` (`apps/api/src/server.ts:117`) is more defensible because it is request/response; a job worker is exactly the place a short graceful drain matters most.
**Suggested fix:** Use `boss.stop({ graceful: true })` (optionally with a bounded timeout) on `SIGTERM`, and only fall back to `graceful: false` on a second signal or after the timeout. Sequence the teardown so `workerDb.destroy()` runs AFTER `boss.stop()` resolves, not concurrently in the same `Promise.allSettled`, so the pool is not torn down beneath an in-flight transaction.

#### [MED] `boss.start()` and worker registration are not awaited as a unit — startup ordering / queue-existence assumption is implicit
**File:** `apps/worker/src/worker.ts:23-36`  
**Invariant violated / concern:** Quality bar — incidental complexity / implicit precondition not enforced.  
**Detail:** The worker calls `boss.start()` (line 23) then `registerDataContextWorker` and `registerBuiltInModuleWorkers`. The pg-boss client is constructed with `migrate: false, createSchema: false` (`packages/jobs/src/pg-boss.ts:46-48`), so the worker silently assumes the pgboss schema and every module queue already exist (created out-of-band by `pnpm db:migrate` / `migratePgBoss`). If the worker is started before migrations have run (a real ordering hazard in a fresh env, and there is no in-process guard or readiness check), `boss.work()` registration against a missing queue behaves implementation-dependently rather than failing with a clear operator-facing error. Nothing in `worker.ts` asserts the expected queues exist before listening.
**Suggested fix:** After `boss.start()`, assert the expected queues exist (e.g. iterate `getAllQueueDefinitions()` and `boss.getQueue(name)`), failing fast with an explicit "run pnpm db:migrate first" message if any are missing. This converts a silent mis-start into a clear precondition error.

#### [MED] No coverage for the worker entrypoint's own failure/lifecycle behavior
**File:** `apps/worker/src/worker.ts:40-72`  
**Invariant violated / concern:** Test dimension G — coverage gap on security-relevant lifecycle code.  
**Detail:** `tests/integration/foundation.test.ts` exercises the RLS-probe round-trip and the `NOBYPASSRLS` grant (good), but it drives pg-boss directly; it does not import or execute `apps/worker/src/worker.ts`. The crash handlers (lines 52-72), the dual shutdown path (lines 40-50), and the `await createEmbeddingProvider` wiring are untested. These are exactly the paths that decide whether a misbehaving handler takes the whole worker down cleanly vs. leaks the DB pool. The `missing actorUserId` guard (`packages/jobs/src/pg-boss.ts:101`) — the worker's actor-validation backstop — also has no asserting test that a payload lacking `actorUserId` is rejected before any repo call.
**Suggested fix:** Add an integration test that (a) sends an `RLS_PROBE_QUEUE` job with no `actorUserId` and asserts the handler throws/fails the job before any DB read, and (b) at minimum smoke-imports `worker.ts` wiring (or factors the wiring into a testable `buildWorker()` function) so shutdown and crash-drain are covered.

#### [LOW] `await` on a synchronous, non-thenable factory is misleading
**File:** `apps/worker/src/worker.ts:21`  
**Invariant violated / concern:** TypeScript dimension D / quality — code implies async behavior that does not exist.  
**Detail:** `const embeddingProvider = await createEmbeddingProvider(getEmbeddingProviderConfig());` — but `createEmbeddingProvider` returns `EmbeddingProvider` synchronously (`packages/memory/src/embedding-provider-config.ts:13`), and `LocalEmbeddingProvider`'s constructor is cheap (the model pipeline loads lazily via `getPipe`, `packages/memory/src/local-embedding-provider.ts:31-34`). The `await` is a no-op that signals a (non-existent) async initialization / model preload, which can mislead a future maintainer into assuming the provider is "ready" after this line.
**Suggested fix:** Drop the `await`: `const embeddingProvider = createEmbeddingProvider(...)`.

#### [LOW] `@jarv1s/memory` is imported by worker.ts but not declared as a dependency
**File:** `apps/worker/package.json:11-15`  
**Invariant violated / concern:** Quality — undeclared dependency (build-graph hazard).  
**Detail:** `worker.ts:9` imports `createEmbeddingProvider`/`getEmbeddingProviderConfig` from `@jarv1s/memory`, but `apps/worker/package.json` lists only `@jarv1s/db`, `@jarv1s/jobs`, `@jarv1s/module-registry`. It currently resolves only because pnpm hoists the transitive copy `@jarv1s/module-registry` pulls in. Any future change to that transitive edge (or stricter pnpm isolation) breaks the worker build, and Turbo's task graph under-orders `@jarv1s/memory` relative to `@jarv1s/worker`.
**Suggested fix:** Add `"@jarv1s/memory": "workspace:*"` to `apps/worker/package.json` dependencies. (`@jarv1s/db` is imported directly too and IS declared — good; just close this one gap.)

#### [LOW] Throwing inside the pg-boss `error` event listener depends on an undocumented coupling to the global crash handler
**File:** `apps/worker/src/worker.ts:67-72` (consumer of `packages/jobs/src/pg-boss.ts:52-54`)  
**Invariant violated / concern:** Error-handling dimension E — control flow that relies on a non-obvious global side effect.  
**Detail:** `createPgBossClient` installs `boss.on("error", (error) => { throw error; })` (`packages/jobs/src/pg-boss.ts:52-54`). Throwing synchronously inside an EventEmitter listener does not propagate to any local `try/catch`; it surfaces as an `uncaughtException`, which the worker catches at `worker.ts:70-72` and turns into `handleCrash` → `process.exit(1)`. The net behavior (fail fast on a pg-boss-level error) is reasonable, but it is entirely implicit: the only thing that keeps a pg-boss connection error from being a silent unhandled throw is the process-level handler living in a different package. A reader of `worker.ts` cannot see why the `boss.on("error")` throw is safe.
**Suggested fix:** Either handle the boss `error` event explicitly in `worker.ts` (log + `handleCrash("pgboss", err)`), or add a comment at the listener noting it intentionally escalates to the process `uncaughtException` handler. Prefer the explicit handler so the fail-fast intent is local and testable.

#### [LOW] Crash/shutdown logging uses `String(err)` / `console.*` — stringified errors can leak nested detail and bypass structured logging
**File:** `apps/worker/src/worker.ts:53-55`  
**Invariant violated / concern:** Hard Invariant 5 (secrets never reach logs) — proximity risk; and quality (ad-hoc logging vs. a logger).  
**Detail:** `handleCrash` logs `err: String(err)` inside a hand-built `JSON.stringify({...})` via `console.error`. For a pg-boss / Postgres connection failure, the stringified error commonly includes the connection string or DSN fragments — and the worker's default DSN embeds a password (`packages/db/src/urls.ts:29`). While production is expected to supply `JARVIS_WORKER_DATABASE_URL`, a connection-error message that echoes the DSN into logs is a credential-in-logs hazard, and `console.error` bypasses any redaction the project's structured logger would apply. Line 38's `console.log` startup banner is benign but is the same ad-hoc pattern.
**Suggested fix:** Route worker logs through the project's structured/redacting logger rather than raw `console.*`, and log `err instanceof Error ? err.message : "unknown"` (plus a redacted stack) instead of `String(err)` so connection strings cannot ride along into the log sink.

#### [INFO] Dead-letter / failed-job payload exposure is bounded but worth a deliberate policy check
**File:** `packages/jobs/src/pg-boss.ts:84-98` (relied on by `apps/worker/src/worker.ts:24-36`)  
**Invariant violated / concern:** Hard Invariant 6 (metadata-only job payloads) — verification note.  
**Detail:** When a handler throws, pg-boss persists the failure with the job's `data` (the payload) in the `pgboss.job` row. This is safe ONLY because the foundation/RLS-probe payloads are metadata-only (`RlsProbeJobPayload = { actorUserId, targetItemId }`, `packages/jobs/src/pg-boss.ts:14-20`). The worker entrypoint enforces no payload-shape policy of its own — it trusts each module's payload to be metadata-only per Invariant 6. That trust is correct for the queues registered here, but the entrypoint provides no defense-in-depth. No action required in `apps/worker` specifically; the metadata-only obligation must be (and is) enforced at each module's `boss.send` call site — audited in the module phases.
**Suggested fix:** None for this file. Treat as a cross-cutting reminder: keep failed-job retention short for any queue whose payload could ever approach content (the probe queue already sets `retentionSeconds: 60`, `pg-boss.ts:32-34`).

#### [INFO] Per-handler payload validation is positional-only at the worker boundary
**File:** `packages/jobs/src/pg-boss.ts:91-96` (consumed by `apps/worker/src/worker.ts:24-35`)  
**Invariant violated / concern:** Error-handling dimension E — boundary validation completeness.  
**Detail:** `registerDataContextWorker` validates exactly one thing at the boundary: `actorUserId` presence (`toAccessContext`, line 101). It does NOT schema-validate the rest of the payload (`targetItemId` and module-specific fields) before handing it to the handler — the handler consumes `job.data.targetItemId` directly (`worker.ts:29`). For the probe this is harmless (a bad id just yields `targetItemVisible: false` under RLS). For richer module payloads, malformed-payload behavior is whatever the individual handler does. This is acceptable for trusted internal producers (only first-party API code calls `boss.send`), but there is no parse-don't-validate guard at the worker edge.
**Suggested fix:** Consider letting `registerDataContextWorker` accept an optional payload schema (e.g. a zod parser) validated once at the boundary, so every queue gets uniform malformed-payload rejection instead of per-handler ad-hoc handling. Not required while producers are first-party.

#### [INFO] Shared mutable state across concurrent handlers — reviewed, clean
**File:** `apps/worker/src/worker.ts:13-36`  
**Invariant violated / concern:** Concurrency review (none).  
**Detail:** The module-level singletons (`workerDb`, `dataContext`, `repository`, `boss`, `embeddingProvider`) are all effectively immutable after construction. `RlsProbeRepository` is stateless (each call takes the per-job `scopedDb`), `DataContextRunner` holds only the root pool and opens a fresh transaction per job, and the embedding provider's only mutable field (`this.pipe`) is an idempotent lazy cache. Concurrency is bounded by the DB pool (`JARVIS_WORKER_DB_POOL_SIZE ?? 4`, line 15) and each job is isolated in its own transaction with its own `set_config(..., is_local=true)`. No cross-handler shared mutable state and no obvious connection/handle leak in the entrypoint (the only lifecycle gap is the shutdown race noted in the MED finding above).
**Suggested fix:** None.
