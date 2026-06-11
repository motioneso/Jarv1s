# packages/jobs — Thermo-Nuclear Code Quality Audit

**Date:** 2026-06-10
**Reviewer:** Automated subagent (Claude Sonnet 4.6)
**Scope:** `packages/jobs/src/` and all consumers: `packages/briefings/src/jobs.ts`, `packages/tasks/src/jobs.ts`, `packages/chat/src/jobs.ts`, `packages/chat/src/live/persistence.ts`, `apps/worker/src/worker.ts`, `apps/api/src/server.ts`, `packages/module-registry/src/index.ts`

---

## Summary

The `@jarv1s/jobs` package is small and reasonably well-structured. The core `registerDataContextWorker` abstraction correctly scopes all worker DB access through `DataContextRunner` / `withDataContext`, eliminating per-handler RLS setup errors. Several significant issues are present in the consumers and one issue is in the core library itself.

---

## Findings

---

### [HIGH] `boss.on("error")` re-throws — unhandled-exception behaviour is runtime-dependent and effectively silent in the API server

- **File:** `packages/jobs/src/pg-boss.ts:52-54`
- **Category:** Error Handling
- **Finding:** `createPgBossClient` installs an `error` handler that rethrows the received error. In Node.js, throwing synchronously inside an `EventEmitter` `error` handler propagates as an uncaughtException in whatever async context pg-boss's internal polling loop runs in — effectively an unhandled rejection. In the **API server** (`apps/api/src/server.ts`), the `process.on("uncaughtException")` and `process.on("unhandledRejection")` handlers are only registered inside the `if (import.meta.url === ...)` guard (lines 149–151), meaning they are **never registered** when the server is loaded as a library (integration tests, programmatic use). A pg-boss internal error in that context crashes the test runner or silently terminates the process without structured logging.
- **Evidence:**
  ```typescript
  // packages/jobs/src/pg-boss.ts:52-54
  boss.on("error", (error) => {
    throw error;
  });
  ```
  ```typescript
  // apps/api/src/server.ts:126,149-151 — handlers only wired in CLI entrypoint guard
  if (import.meta.url === `file://${process.argv[1]}`) {
    ...
    process.on("unhandledRejection", (reason) => { handleCrash(...) });
    process.on("uncaughtException", (err: Error) => { handleCrash(...) });
  ```
- **Impact:** A pg-boss internal error (network blip, schema version mismatch, connection exhaustion) causes an unhandled crash with no structured log entry when the API server is used as a library. In tests, it crashes the test runner mid-suite.
- **Recommendation:** Replace the `throw error` pattern with a structured logger call or a configurable `onError` callback. The safest fix: accept an optional `onError?: (err: Error) => void` in `createPgBossClient` options and default it to `(err) => console.error('[pg-boss]', err)`. Never re-throw inside an EventEmitter error handler.

---

### [MEDIUM] Chat queues (`chat.embed-turn`, `chat.extract-facts`) have no metadata-only payload guard — inconsistent with all other queues

- **File:** `packages/chat/src/jobs.ts` (no guard present); compare `packages/briefings/src/jobs.ts:55-73`, `packages/tasks/src/jobs.ts:52-75`
- **Category:** Payloads / Architecture
- **Finding:** The tasks and briefings workers each call `isDeferredTaskStatusPayloadMetadataOnly` / `isBriefingRunPayloadMetadataOnly` inside the worker handler (throwing if extra keys are found) and at the send site. The chat module has neither: no `isChatEmbedTurnPayloadMetadataOnly` function, no check at send time in `persistence.ts`, and no check inside the `registerChatJobWorkers` handlers. The current payloads happen to be metadata-only by construction (`actorUserId`, `threadId`, `messageId`) but nothing enforces this. A future developer adding a field (e.g. a message snippet for debugging) to `EmbedTurnJobPayload` would unknowingly violate the hard invariant.
- **Evidence:**
  ```typescript
  // packages/chat/src/jobs.ts — no metadata-only constants or guard function
  export interface EmbedTurnJobPayload extends ActorScopedJobPayload {
    readonly threadId: string;
    readonly messageId: string;
  }
  // No EMBED_TURN_PAYLOAD_KEYS, no isEmbedTurnPayloadMetadataOnly(), no check in worker
  ```
  ```typescript
  // packages/briefings/src/jobs.ts:55-73 — the enforced pattern:
  export const BRIEFING_RUN_PAYLOAD_KEYS = [...] as const;
  export function isBriefingRunPayloadMetadataOnly(...): boolean { ... }
  // ...called at send site AND in worker handler
  ```
- **Impact:** Violates hard invariant "Metadata-only job payloads." The chat module's queues could silently carry content or secrets if the payload types are extended. The inconsistency also creates a false impression that only some queues require the invariant.
- **Recommendation:** Add `EMBED_TURN_PAYLOAD_KEYS`, `EXTRACT_FACTS_PAYLOAD_KEYS`, and corresponding `isEmbedTurnPayloadMetadataOnly` / `isExtractFactsPayloadMetadataOnly` functions. Call them at send time in `persistence.ts` and inside the respective workers. Add the chat queues to the chatModuleManifest `jobs[]` array with `metadataOnly: true`. Add an integration test verifying the payload stored in `pgboss.job_common` contains only the expected keys.

---

### [MEDIUM] Chat manifest missing `jobs[]` declaration — queues unauditable via manifest

- **File:** `packages/chat/src/manifest.ts` (no `jobs` field); compare `packages/briefings/src/manifest.ts:124-131`, `packages/tasks/src/manifest.ts:219-226`
- **Category:** Architecture
- **Finding:** The `chatModuleManifest` does not declare a `jobs` array even though the module registers two pg-boss queues (`chat.embed-turn`, `chat.extract-facts`). The briefings and tasks manifests both declare their queues with `queueName`, `payloadSchema`, and `metadataOnly: true`. The `jobs` field on `JarvisModuleManifest` is optional (`readonly jobs?: readonly ModuleJobManifest[]`) so this passes the TypeScript compiler, but it means the chat queues are invisible to any tooling that audits job declarations through the manifest. The `getAllQueueDefinitions()` function routes queue provisioning correctly via `CHAT_QUEUE_DEFINITIONS` in the registration array, but that is separate from the manifest contract.
- **Evidence:**
  ```typescript
  // packages/chat/src/manifest.ts — no jobs field at all
  export const chatModuleManifest = {
    ...
    routes: [...],
    // ← no jobs: [...]
  } satisfies JarvisModuleManifest;
  ```
- **Impact:** Audit tools, documentation generators, and future access-control tooling that traverse manifests to enumerate job queues will silently omit chat. Inconsistency with all other queue-owning modules.
- **Recommendation:** Add `jobs: [{ queueName: CHAT_EMBED_TURN_QUEUE, metadataOnly: true }, { queueName: CHAT_EXTRACT_FACTS_QUEUE, metadataOnly: true }]` to `chatModuleManifest`.

---

### [MEDIUM] `idempotencyKey` in task and briefing payloads is dead data — accepted, stored, never wired to pg-boss deduplication

- **File:** `packages/briefings/src/jobs.ts:19`, `packages/tasks/src/jobs.ts:16`; send sites `packages/briefings/src/routes.ts:136`, `packages/tasks/src/routes.ts:270`
- **Category:** Code Quality / Architecture
- **Finding:** Both `BriefingRunPayload` and `DeferredTaskStatusPayload` carry an optional `idempotencyKey`. The key is accepted in the API body, stored in the payload, and included in the metadata-only key allowlist — but it is never passed to `boss.send()` as the pg-boss `singletonKey` option, and never read inside the worker handlers. The callers cannot achieve idempotency through repeated sends with the same key. The field is vestigial: it creates a false API contract ("pass this to get idempotent behaviour") while providing none.
- **Evidence:**
  ```typescript
  // packages/briefings/src/routes.ts:124-136 — key goes into payload, not into send options
  const payload: BriefingRunPayload = {
    actorUserId: accessContext.actorUserId,
    definitionId: definition.id,
    briefingRunId: runId,
    runKind: "manual",
    idempotencyKey: body.idempotencyKey  // ← stored in payload
  };
  const jobId = await dependencies.boss.send(BRIEFINGS_RUN_QUEUE, payload);
  // ← no { singletonKey: payload.idempotencyKey } options object
  ```
- **Impact:** Callers relying on idempotencyKey to prevent duplicate jobs (e.g. on network retry) will enqueue N duplicate jobs. Incidental complexity: the field is defined, validated, included in the metadata-only allowlist, and tested — but does nothing.
- **Recommendation:** Either (a) wire the key as the pg-boss `singletonKey`: `boss.send(queue, payload, { singletonKey: payload.idempotencyKey })` — but only when the key is present, since pg-boss treats every send with the same singletonKey as a deduplicated singleton; or (b) remove `idempotencyKey` from both payload types, the API schemas, the parse functions, and the manifest payload schemas if true deduplication is not needed. Option (b) is simpler; choose option (a) only when the caller-side retry pattern is a verified requirement.

---

### [MEDIUM] Two `boss.send()` calls inside a `withDataContext` transaction are not atomic — orphaned job on partial failure

- **File:** `packages/chat/src/live/persistence.ts:90,104-117`
- **Category:** Architecture / Error Handling
- **Finding:** The `recordTurn` method calls `this.run(...)` which wraps the entire body in `dataContext.withDataContext(...)` — a Kysely database transaction. Inside that transaction (lines 104–116), two sequential `boss.send()` calls are made to pg-boss. `boss.send()` uses **pg-boss's own connection pool**, not the Kysely transaction. This means:
  1. The pg-boss job is enqueued immediately, **outside** the app transaction.
  2. If the app transaction later rolls back (e.g. the `touchThread` at line 102 fails), the already-enqueued job(s) remain in pg-boss.
  3. If the first `boss.send` succeeds and the second throws, the first job is orphaned and the transaction rolls back.
- **Evidence:**
  ```typescript
  // packages/chat/src/live/persistence.ts:90-117
  await this.run(actorUserId, "record-turn", async (scopedDb) => {
    // ...inside Kysely transaction...
    await this.chat.touchThread(scopedDb, thread.id);   // ← may fail
    if (this.boss && result && !thread.incognito) {
      await this.boss.send(CHAT_EMBED_TURN_QUEUE, embedPayload);   // ← outside tx
      await this.boss.send(CHAT_EXTRACT_FACTS_QUEUE, extractPayload); // ← outside tx
    }
  });
  ```
- **Impact:** An orphaned embed-turn job will try to read a message that was never committed. The embed handler at `packages/chat/src/jobs.ts:52` returns early when `lastTwo.length < 2`, so this does not cause data corruption — but it introduces silent no-op job noise and obscures monitoring. If the chat module later stores more state, the atomicity gap becomes a real consistency hazard.
- **Recommendation:** Move the `boss.send()` calls **outside** the `withDataContext` transaction (i.e. after `this.run(...)` resolves). Enqueue only if the DB operation succeeded: this is the standard "transactional outbox" pattern. For a simpler fix at current scale: resolve the run first, then enqueue if `result` is truthy — moving lines 104–117 after the `await this.run(...)` call.

---

### [MEDIUM] `pgboss.job_common` has no row-level security — any `jarvis_app_runtime`/`jarvis_worker_runtime` connection can read all users' job payloads

- **File:** `infra/postgres/grants/0001_pgboss_runtime_grants.sql`
- **Category:** Security
- **Finding:** The grants file gives both `jarvis_app_runtime` and `jarvis_worker_runtime` `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss`. pg-boss does not apply RLS internally. There is no RLS policy on `pgboss.job_common` or any other pgboss table. A bug in a route handler that exposes raw pgboss queries, or a future worker that reads job history for monitoring, would expose all users' job metadata (actorUserId, resource IDs, operation types, timestamps) without restriction.
- **Evidence:**
  ```sql
  -- infra/postgres/grants/0001_pgboss_runtime_grants.sql
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss
    TO jarvis_app_runtime, jarvis_worker_runtime;
  ```
- **Impact:** Currently the payloads are metadata-only (IDs, no content), so the exposure is limited to cross-user job visibility — which queues a user enqueued, when, and for which resource IDs. If payloads ever grow (violating the hard invariant), the damage is compounded. This is defence-in-depth: the hard invariant already prohibits content in payloads, but the DB layer provides no backstop.
- **Recommendation:** This is inherent to pg-boss (it manages its own schema) and cannot be easily fixed with RLS on a per-user basis. The risk is best mitigated by: (1) reinforcing the metadata-only invariant with type-level and runtime guards on every queue (see finding above re: chat queues); (2) ensuring no route ever passes a raw Kysely instance to pgboss queries; (3) documenting the grant explicitly in the grants file with a comment explaining why broad access is intentional and that RLS is enforced at the application layer via payload scoping only.

---

### [MEDIUM] `rls-probe` worker has no metadata-only guard — inconsistent with all other module workers

- **File:** `apps/worker/src/worker.ts:24-35`
- **Category:** Payloads / Architecture
- **Finding:** The `rls-probe` queue worker (the only foundation queue outside a module) does not check whether the job payload is metadata-only, whereas both the tasks and briefings workers include this guard. The `RlsProbeJobPayload` (`actorUserId`, `targetItemId`) is currently metadata-only, but there is no runtime enforcement.
- **Evidence:**
  ```typescript
  // apps/worker/src/worker.ts:24-35 — no metadata-only check
  await registerDataContextWorker<RlsProbeJobPayload, { targetItemVisible: boolean }>(
    boss,
    RLS_PROBE_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      const item = await repository.getById(scopedDb, job.data.targetItemId);
      return { targetItemVisible: item !== undefined };
    }
  );
  ```
- **Impact:** Inconsistency with the established pattern. Future extension of `RlsProbeJobPayload` could silently carry content.
- **Recommendation:** Add `RLS_PROBE_PAYLOAD_KEYS` and `isRlsProbePayloadMetadataOnly` to `packages/jobs/src/pg-boss.ts`, and call it in the worker before delegating to the repository.

---

### [LOW] `WorkOptions` default `pollingIntervalSeconds: 2` is set globally; individual queues cannot tune polling without overriding the entire options object

- **File:** `packages/jobs/src/pg-boss.ts:89`
- **Category:** Architecture / Code Quality
- **Finding:** `registerDataContextWorker` defaults `options` to `{ pollingIntervalSeconds: 2 }`. Any caller that wants to change a single option (e.g. `teamSize`) must provide the entire `WorkOptions` object, re-specifying pollingInterval. Additionally, all queues use the same 2-second polling regardless of their latency requirements (embed-turn vs briefings-run have very different urgency profiles).
- **Evidence:**
  ```typescript
  // packages/jobs/src/pg-boss.ts:84,89
  export async function registerDataContextWorker<...>(
    ...
    options: WorkOptions = { pollingIntervalSeconds: 2 }
  ): Promise<string> {
  ```
- **Impact:** Low — pollingInterval of 2 seconds is reasonable for all current queues. The ergonomics issue is minor but will become relevant when queues need different concurrency profiles.
- **Recommendation:** Consider merging caller-supplied options with the default rather than replacing: `const resolved = { pollingIntervalSeconds: 2, ...options }`. This allows callers to override individual fields without specifying all of them.

---

### [LOW] `graceful: false` on `boss.stop()` in production teardown can orphan in-flight jobs

- **File:** `apps/worker/src/worker.ts:41`, `apps/api/src/server.ts:117`, `packages/jobs/src/pg-boss.ts:80`
- **Category:** Error Handling
- **Finding:** All `boss.stop()` calls pass `{ graceful: false }`, which tells pg-boss to stop immediately without waiting for in-flight job handlers to complete. On SIGTERM, any job currently executing in the worker will be interrupted mid-handler. The job will be re-queued (if `retryLimit > 0`) or marked as failed. For `retryLimit: 0` queues (rls-probe, tasks, briefings), the interrupted job is permanently lost.
- **Evidence:**
  ```typescript
  // apps/worker/src/worker.ts:41
  await Promise.allSettled([boss.stop({ graceful: false }), workerDb.destroy()]);
  ```
- **Impact:** Under normal conditions (Kubernetes rolling restart, Docker stop), an in-flight briefing run or task status update is silently discarded. Severity is LOW because all queue jobs are retryLimit:0 (so re-queuing is not the intent anyway), but it does mean jobs started just before shutdown are silently lost without error logging.
- **Recommendation:** For a graceful shutdown, change to `boss.stop()` (defaults to `{ graceful: true }`) or `boss.stop({ graceful: true, timeout: 10_000 })`. Add a note in the migration script's `migratePgBoss` function (which also uses `graceful: false`) that the non-graceful stop there is intentional (no workers are registered during migration).

---

### [LOW] `unsafeSelectVisibleProbeIdsForTest` is exported on the production `DataContextRunner` class

- **File:** `packages/db/src/data-context.ts:41-49`
- **Category:** Architecture / Code Quality
- **Finding:** `DataContextRunner` exposes a `unsafeSelectVisibleProbeIdsForTest()` method that queries `app.rls_probe_items` without a user context. This is a test-only helper that uses the root Kysely instance directly, bypassing RLS. It is only invoked in integration tests and spikes, never in production code — but it is part of the public API surface of the production class and exported through the package.
- **Evidence:**
  ```typescript
  // packages/db/src/data-context.ts:41-49
  async unsafeSelectVisibleProbeIdsForTest(): Promise<string[]> {
    const rows = await this.rootDb
      .selectFrom("app.rls_probe_items")
      .select("id")
      .orderBy("id")
      .execute();
    return rows.map((row) => row.id);
  }
  ```
- **Impact:** No production risk currently. Architecturally, test-only helpers on production classes are a code quality smell: they pollute the API surface, tempt future misuse, and make it harder to identify what the class's real invariants are.
- **Recommendation:** Extract this into a separate `RlsProbeTestHelper` class in a test-support package or in `packages/db/src/probes/`. Alternatively, scope it behind a TypeScript `/* @internal */` annotation and document it as test-only. Remove it from the exported production API surface.

---

### [LOW] `EmbedTurnJobPayload` carries `messageId` — field is unused in the worker handler

- **File:** `packages/chat/src/jobs.ts:26-29`; handler `packages/chat/src/jobs.ts:41-94`
- **Category:** Code Quality
- **Finding:** `EmbedTurnJobPayload` declares `readonly messageId: string` and `persistence.ts` populates it with `result.assistantMessage.id` (line 108). However, `handleEmbedTurnJob` (the actual worker handler) does not accept or use `messageId` — it re-fetches messages by threadId and slices the last two. The field is sent over the wire, stored in pg-boss, and passed to the handler, but never read.
- **Evidence:**
  ```typescript
  // packages/chat/src/jobs.ts:26-29
  export interface EmbedTurnJobPayload extends ActorScopedJobPayload {
    readonly threadId: string;
    readonly messageId: string;   // ← declared
  }
  // handleEmbedTurnJob signature (line 41-47):
  export async function handleEmbedTurnJob(
    scopedDb: DataContextDb,
    ownerUserId: string,
    threadId: string,       // ← but messageId not a param
    embeddingProvider: EmbeddingProvider,
    ...
  ```
  ```typescript
  // packages/chat/src/jobs.ts:132-141 — messageId not passed to handler
  async (job, scopedDb) => {
    await handleEmbedTurnJob(
      scopedDb,
      job.data.actorUserId,
      job.data.threadId,   // ← only threadId
      options.embeddingProvider,
      ...
  ```
- **Impact:** Dead field in payload; creates confusion about whether messageId serves a purpose (it looks like a targeted embed, but is not). Could mislead a developer into thinking the embed is already idempotent per-message when it is not.
- **Recommendation:** Either (a) remove `messageId` from `EmbedTurnJobPayload` and from `persistence.ts` if it provides no targeting benefit; or (b) plumb it into `handleEmbedTurnJob` to scope the embed to the specific message pair rather than always taking the last two stored messages. Option (b) is more correct semantically and fixes a latent bug where a rapid second turn could cause the wrong message pair to be embedded.

---

### [LOW] Integration test verifying chat job payload metadata-only is absent

- **File:** `tests/integration/` — no file asserts chat queue payload schema
- **Category:** Tests
- **Finding:** The tasks integration test (`tests/integration/tasks.test.ts:428-464`) and briefings test (`tests/integration/briefings.test.ts:334-386`) each include a dedicated test that reads the raw payload from `pgboss.job_common` and asserts it contains only the expected keys and no content/credentials. No equivalent test exists for `chat.embed-turn` or `chat.extract-facts`. The `ai-tools.test.ts` only verifies the queue names exist, not their payload contents.
- **Evidence:**
  Absence of assertion in `tests/integration/chat-live.test.ts`, `tests/integration/chat-live-api.test.ts`, and `tests/integration/chat-recall.test.ts`.
- **Impact:** A regression that adds a content field to `EmbedTurnJobPayload` would pass all tests. The metadata-only invariant for chat queues is unenforced at the test level.
- **Recommendation:** Add a test case in `chat-live.test.ts` or a dedicated `chat-jobs.test.ts` that: (1) sends a message, (2) queries `pgboss.job_common WHERE name = 'chat.embed-turn'`, (3) asserts the payload equals `{ actorUserId, threadId, messageId }` and does not contain any message content.

---

### [INFO] `migratePgBoss` creates its own `PgBoss` instance with `migrate: true` then stops it — correct pattern, but `graceful: false` in the finally block is intentional

- **File:** `packages/jobs/src/pg-boss.ts:59-82`
- **Category:** Architecture
- **Finding:** The migration function creates a separate PgBoss instance with `migrate: true`, runs queue provisioning, and stops it `graceful: false` in `finally`. This is the correct pattern for migration-time pg-boss setup. The `graceful: false` here is intentional — no workers are registered during migration so there are no in-flight jobs to drain. This pattern is sound.
- **Recommendation:** Add a brief inline comment on the `graceful: false` stop in `migratePgBoss` to distinguish it from the production teardown case, preventing future "fix" of making it graceful unnecessarily.

---

### [INFO] No job query / cancellation API surface exists — correct omission

- **File:** All route files reviewed
- **Category:** Security / Architecture
- **Finding:** There are no routes that allow querying job status by jobId or cancelling a job. The jobId returned in 202 responses (`packages/briefings/src/routes.ts:142`, `packages/tasks/src/routes.ts:272`) is opaque to the caller — there is no API to look up a job by its pg-boss UUID. This is correct: it eliminates the job-visibility attack surface (User A using User B's jobId to probe job status).
- **Recommendation:** When job status polling is added in a future milestone, ensure it routes through the application's RLS-scoped data layer (checking that the job's `actorUserId` matches the requesting user) rather than querying `pgboss.job_common` directly.

---

## Coverage Map

| File | Reviewed | Key concern |
|---|---|---|
| `packages/jobs/src/pg-boss.ts` | Yes | boss.on error re-throw; no RLS probe guard |
| `packages/jobs/src/index.ts` | Yes | Re-export only |
| `packages/briefings/src/jobs.ts` | Yes | idempotencyKey dead; otherwise sound |
| `packages/tasks/src/jobs.ts` | Yes | idempotencyKey dead; otherwise sound |
| `packages/chat/src/jobs.ts` | Yes | No metadata guard; messageId unused |
| `packages/chat/src/live/persistence.ts` | Yes | boss.send outside transaction atomicity gap |
| `apps/worker/src/worker.ts` | Yes | No metadata guard on RLS probe; graceful:false |
| `apps/api/src/server.ts` | Yes | uncaughtException only in CLI guard |
| `packages/module-registry/src/index.ts` | Yes | Chat manifest missing jobs[] |
| `infra/postgres/grants/0001_pgboss_runtime_grants.sql` | Yes | Full pgboss CRUD, no RLS |
| `packages/db/src/data-context.ts` | Yes | unsafeSelect on production class |
