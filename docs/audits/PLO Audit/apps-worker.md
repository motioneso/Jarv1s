# apps/worker — Thermo-Nuclear Code Quality Audit

**Scope:** `apps/worker/src/worker.ts` and all job-handling code it transitively owns:
`packages/jobs/src/pg-boss.ts`, `packages/tasks/src/jobs.ts`,
`packages/briefings/src/jobs.ts`, `packages/chat/src/jobs.ts`,
`packages/module-registry/src/index.ts`

**Date:** 2026-06-10

---

## Summary Scorecard

| Area | Status |
|---|---|
| DB role / NOBYPASSRLS | PASS — `jarvis_worker_runtime` carries `NOBYPASSRLS` in bootstrap |
| RLS enforcement | PASS for all module tables; INFO gap on `workspaces`/`instance_settings` |
| `actorUserId` presence check | PASS — `toAccessContext` throws on falsy value |
| `actorUserId` format check | FAIL — not validated as UUID (HIGH) |
| Metadata-only payload guard | PASS for tasks/briefings; ABSENT for chat embed/extract (HIGH) |
| Payload validation at handler entry | PASS — structural check before any DB work |
| Module isolation | NEAR-PASS — one legitimate cross-module call (briefings → @jarv1s/ai) |
| DataContextDb-only access | PASS — all repos use `assertDataContextDb`; MemoryRepository FAIL (MEDIUM) |
| Secret exposure in crash log | MEDIUM — `String(err)` can render connection strings |
| Transaction safety | PASS — `DataContextRunner.withDataContext` wraps every handler in one transaction |
| pg-boss `error` event handler | HIGH — `throw error` in EventEmitter context crashes process unsafely |
| Shutdown correctness | MEDIUM — `graceful: false` kills in-flight jobs; `void` ignores shutdown errors |
| Concurrency / shared mutable state | LOW — `embeddingProvider` pipeline is lazy-init with no mutex |
| Job retention / dead-letter hygiene | MEDIUM — chat queues have no `retentionSeconds`; payload stays in pgboss |
| Worker `maxConnections` env parse | LOW — `Number()` silently returns NaN on invalid input |
| Chat embed thread ownership | MEDIUM — embed job fetches all messages for the thread without a WHERE on owner |
| Briefing tool execution context | HIGH — `actorUserId: ""` passed to tool execute context |
| `ToolContext.actorUserId` empty | HIGH — allows tool execute to act without a real actor |
| `retentionSeconds` missing on chat queues | MEDIUM |
| Ghost env var `JARVIS_WORKER_DB_POOL_SIZE` | LOW — undocumented in env.production.example |

---

## Findings

### [HIGH] `toAccessContext` does not validate `actorUserId` as a UUID

- **File:** `packages/jobs/src/pg-boss.ts:101`
- **Category:** Security
- **Finding:** `toAccessContext` checks `!job.data.actorUserId` (falsy), but does not verify that the value is a well-formed UUID before passing it to `set_config('app.actor_user_id', ...)`. The DB function `app.current_actor_user_id()` silently returns `NULL` on `invalid_text_representation`, meaning a crafted non-UUID string passes the check, enters the transaction, triggers no DB error, and the RLS `USING (id = app.current_actor_user_id())` predicate evaluates to `false` for every row. The job then proceeds to the handler with a scoped DB context that matches no rows — a silent no-op rather than a visible rejection.
- **Evidence:**
  ```ts
  function toAccessContext(job: Job<ActorScopedJobPayload>): AccessContext {
    if (!job.data.actorUserId) {
      throw new Error(`Job ${job.id} is missing actorUserId`);
    }
    return { actorUserId: job.data.actorUserId, requestId: `pgboss:${job.id}` };
  }
  ```
- **Impact:** A malformed `actorUserId` (e.g., an empty string somehow bypassing the falsy check, or a string like `"null"`) silently scopes the context to NULL in the DB. The handler may silently succeed while operating on no rows, which can create phantom job completions (e.g., a task status update that reports `updated: false` but doesn't fail) with no visibility that the actor binding was lost.
- **Recommendation:** Add a UUID format check before constructing AccessContext:
  ```ts
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(job.data.actorUserId)) {
    throw new Error(`Job ${job.id} has invalid actorUserId: ${job.data.actorUserId}`);
  }
  ```

---

### [HIGH] Briefing job worker passes `actorUserId: ""` to tool execute context

- **File:** `packages/briefings/src/repository.ts:258`
- **Category:** Security
- **Finding:** `generateSummary` — which runs inside the job handler's `withDataContext` transaction and is therefore scoped to the real actor — calls `manifestTool.execute(scopedDb, {}, { actorUserId: "", requestId: "", chatSessionId: "" })`. The `ToolContext` passed to every tool has an empty actor ID. If any tool's `execute` implementation uses `ctx.actorUserId` for anything beyond what the `scopedDb` RLS already enforces (e.g., logging, audit trail, or a secondary verification), it will receive an empty string.
- **Evidence:**
  ```ts
  const toolResult = await manifestTool.execute(
    scopedDb,
    {},
    {
      actorUserId: "",     // ← empty
      requestId: "",       // ← empty
      chatSessionId: ""    // ← empty
    }
  );
  ```
- **Impact:** The hard invariant "AccessContext carries only `actorUserId` and `requestId`" is upheld at the DB layer (RLS uses `app.current_actor_user_id()` from the transaction, not `ToolContext`), so row-level access is not directly bypassed here. However, `ToolContext.actorUserId` is a declared part of the public tool execution contract; an empty string breaks any tool that relies on it for secondary checks, audit logging, or building compound queries outside raw SQL. It also sets a bad precedent for future tools that might naively trust `ctx.actorUserId`.
- **Recommendation:** Pass the real actor ID. `getOwnedDefinitionById` already knows `definition.owner_user_id`; the RLS context exposes `app.current_actor_user_id()` which can be read from the transaction if needed. At minimum, thread the actor user ID through `GenerateBriefingRunInput` or extract it from the definition before calling `generateSummary`.

---

### [HIGH] pg-boss `error` event handler `throw`s inside an EventEmitter callback

- **File:** `packages/jobs/src/pg-boss.ts:52–55`
- **Category:** Error Handling
- **Finding:** The pg-boss `error` event is emitted by the internal `EventEmitter`. Throwing inside an EventEmitter `error` listener is not the same as a Promise rejection — it generates an uncaught exception. In Node.js, if the `error` event listener itself throws, the exception propagates synchronously up the call stack through the EventEmitter internals, which typically terminates the process via `uncaughtException`. While the worker does register an `uncaughtException` handler, it does so only after the initialization block, creating a race window. More critically, `throw error` inside an EventEmitter callback leaks the raw pg-boss error (which may contain the database connection string or query text) directly to the crash log via `handleCrash`'s `String(err)` serialization.
- **Evidence:**
  ```ts
  boss.on("error", (error) => {
    throw error;   // throws synchronously inside EventEmitter
  });
  ```
- **Impact:** Any internal pg-boss connection or poll error (which may contain credentials embedded in the DSN in the error message) is serialized via `String(err)` and written to `console.error` as a fatal log. The thrown error also bypasses normal pg-boss error recovery — pg-boss is designed to emit `error` for non-fatal internal issues and expects the listener to handle it gracefully, not crash the process.
- **Recommendation:** Replace with a structured log-and-continue (or log-and-shutdown) pattern that does not expose raw error messages:
  ```ts
  boss.on("error", (error) => {
    console.error(JSON.stringify({
      level: "error",
      msg: "pg-boss internal error",
      name: error instanceof Error ? error.name : "unknown"
    }));
  });
  ```
  If the intent is to treat any pg-boss error as fatal, call `handleCrash` explicitly (which is already defined and sanitizes output).

---

### [HIGH] Chat embed/extract job payloads have no metadata-only guard

- **File:** `packages/chat/src/jobs.ts:128–155`
- **Category:** Payloads
- **Finding:** The tasks and briefings job handlers both call `isDeferredTaskStatusPayloadMetadataOnly` / `isBriefingRunPayloadMetadataOnly` at handler entry to enforce the metadata-only payload invariant. The chat embed and extract job handlers have no equivalent check. If a caller sends a payload with extra fields (including private content, message bodies, or secrets) for `chat.embed-turn` or `chat.extract-facts`, the worker will silently accept and process it.
- **Evidence:**
  ```ts
  const embedWorkId = await registerDataContextWorker<EmbedTurnJobPayload, void>(
    boss,
    CHAT_EMBED_TURN_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      await handleEmbedTurnJob(        // ← no metadata-only check
        scopedDb,
        job.data.actorUserId,
        job.data.threadId,
        ...
      );
    },
  );
  ```
- **Impact:** If any consumer (now or in future) accidentally includes private content or session tokens in the `chat.embed-turn` payload, the worker will process it without any defensive rejection. This violates the hard invariant "Metadata-only job payloads." Chat is the highest-risk module for this because the natural temptation is to embed the message text directly in the payload.
- **Recommendation:** Define `CHAT_EMBED_TURN_PAYLOAD_KEYS = ["actorUserId", "threadId", "messageId"]` and `CHAT_EXTRACT_FACTS_PAYLOAD_KEYS = ["actorUserId", "threadId"]` and add the same whitelist check pattern used in tasks and briefings at handler entry. Add `metadataOnly: true` to the chat job manifest entries.

---

### [MEDIUM] `MemoryRepository` methods do not call `assertDataContextDb`

- **File:** `packages/memory/src/repository.ts:23–196`
- **Category:** Architecture
- **Finding:** Every repository in the codebase calls `assertDataContextDb(scopedDb)` as the first line of public methods to verify the DB handle is a properly branded `DataContextDb`. `MemoryRepository` accepts `DataContextDb` typed parameters but never calls `assertDataContextDb`. The only enforcement is the TypeScript structural type, which can be fooled by a cast.
- **Evidence:**
  ```ts
  async upsertFileChunks(
    scopedDb: DataContextDb,
    ownerUserId: string,
    ...
  ): Promise<void> {
    await this.deleteFileChunks(scopedDb, ownerUserId, sourcePath, sourceKind);  // no assert
    ...
  ```
- **Impact:** The brand check is the last line of defense ensuring repository methods are only called within a `withDataContext` transaction. Without it, a future caller that passes a naked `Kysely` instance or a hand-crafted object bypasses the RLS actor scoping entirely. This is particularly concerning for the memory module because it is called from the chat job handler which runs in the worker process.
- **Recommendation:** Add `assertDataContextDb(scopedDb)` as the first line of every public `MemoryRepository` method.

---

### [MEDIUM] Crash handler serializes raw errors that may contain DB credentials

- **File:** `apps/worker/src/worker.ts:53–55`
- **Category:** Security
- **Finding:** The `handleCrash` function logs `err: String(err)`, where `err` is any `unknown` from `unhandledRejection` or `uncaughtException`. In Node.js, errors from database driver connection failures often include the connection string in `error.message`, which may contain the database password (the docker-compose default passwords are `worker_password`). In production, these are real credentials.
- **Evidence:**
  ```ts
  console.error(
    JSON.stringify({ level: "fatal", label, err: String(err), msg: "Process crash — exiting" })
  );
  ```
- **Impact:** If the Postgres connection fails with an authentication error, the full DSN (including the password) may appear in `String(err)` and be written to container logs. Container log aggregators (e.g., Datadog, CloudWatch) typically store these indefinitely.
- **Recommendation:** Sanitize before logging: log only `error.name` and a safe subset of `error.message` (truncated, DSN-stripped). Alternatively, use a structured logger that accepts a safe error object:
  ```ts
  const safeErr = err instanceof Error
    ? { name: err.name, message: err.message.replace(/postgres:\/\/[^@]+@[^/]+/g, "postgres://***@***") }
    : String(err);
  ```

---

### [MEDIUM] `boss.stop({ graceful: false })` kills in-flight job handlers on shutdown

- **File:** `apps/worker/src/worker.ts:41`
- **Category:** Error Handling
- **Finding:** On SIGINT/SIGTERM and on crash, shutdown calls `boss.stop({ graceful: false })`. This immediately terminates pg-boss polling and drops in-flight work without waiting for running handlers to complete. Any handler mid-transaction will have its DB connection dropped, causing the transaction to be rolled back, but the pg-boss job may remain in `working` state (not failed) until the lock expires, depending on pg-boss version behavior.
- **Evidence:**
  ```ts
  async function shutdown(): Promise<void> {
    await Promise.allSettled([boss.stop({ graceful: false }), workerDb.destroy()]);
  }
  ```
- **Impact:** For SIGTERM (normal container stop), in-flight tasks or briefing runs may be abandoned and not retried (because `retryLimit: 0`). For the embed-turn queue (`retryLimit: 2`), jobs may retry correctly, but the abandoned state creates an inconsistency window. `Promise.allSettled` also means errors from either `boss.stop` or `workerDb.destroy` are silently swallowed.
- **Recommendation:** Use `graceful: true` for SIGTERM and reserve `graceful: false` for crash-path only. Also log shutdown errors:
  ```ts
  const results = await Promise.allSettled([boss.stop({ graceful: label !== "crash" }), workerDb.destroy()]);
  for (const r of results) {
    if (r.status === "rejected") console.error(JSON.stringify({ level: "warn", msg: "shutdown error", err: String(r.reason) }));
  }
  ```

---

### [MEDIUM] Chat job queues lack `retentionSeconds`

- **File:** `packages/chat/src/jobs.ts:19–22`
- **Category:** Payloads
- **Finding:** `CHAT_EMBED_TURN_QUEUE` and `CHAT_EXTRACT_FACTS_QUEUE` define `deleteAfterSeconds: 600` but no `retentionSeconds`. Without `retentionSeconds`, pg-boss uses its default retention (typically 30 days), meaning failed/archived jobs (including their payloads — `threadId`, `actorUserId`) remain in the `pgboss` schema tables for 30 days. Tasks and briefings both set `retentionSeconds: 60`.
- **Evidence:**
  ```ts
  { name: CHAT_EMBED_TURN_QUEUE, options: { retryLimit: 2, deleteAfterSeconds: 600 } },
  { name: CHAT_EXTRACT_FACTS_QUEUE, options: { retryLimit: 2, deleteAfterSeconds: 600 } }
  ```
- **Impact:** Dead-letter chat jobs remain in the `pgboss.job` table for 30 days by default. While the payload is only metadata (threadId/messageId), long retention increases the attack surface if the pgboss schema is ever accessed by a compromised role.
- **Recommendation:** Add `retentionSeconds: 600` (or a similarly short value matching `deleteAfterSeconds`) to both chat queue definitions.

---

### [MEDIUM] Chat embed job fetches all messages for a thread without explicit owner check

- **File:** `packages/chat/src/jobs.ts:49`
- **Category:** Security
- **Finding:** `handleEmbedTurnJob` calls `chatRepository.listMessages(scopedDb, threadId)` where `listMessages` queries `chat_messages` filtered only by `thread_id`. RLS on `chat_messages` requires the thread to be owned by (or shared with) the current actor (`current_actor_user_id()`). The `actorUserId` in the AccessContext comes from `job.data.actorUserId`. If `actorUserId` is tampered or belongs to a different user than the thread owner, RLS will silently return no rows (rather than an error), and `handleEmbedTurnJob` returns early without embedding — a silent no-op rather than a security failure.
- **Evidence:**
  ```ts
  const messages = await chatRepository.listMessages(scopedDb, threadId);
  // RLS silently returns [] if actorUserId ≠ thread owner
  const stored = messages.filter((m) => m.status === "stored");
  const lastTwo = stored.slice(-2);
  if (lastTwo.length < 2) return;   // silent success
  ```
- **Impact:** This is defense-in-depth: RLS does enforce the isolation, so no cross-user data is actually embedded. However, the handler treats an empty result identically to "no turn to embed," making it impossible to distinguish a legitimate no-turn case from a cross-user job dispatch. This masks potential misuse. Additionally, `ownerUserId` is passed from `job.data.actorUserId` to `memoryRepository.upsertFileChunks` as the chunk owner — if the job was crafted with a mismatched `actorUserId`/`threadId`, the RLS returns nothing and no embed occurs, but the failure is invisible.
- **Recommendation:** Add an explicit ownership check: verify that the thread exists and belongs to the actor before processing. Return an error (not a silent no-op) if the thread is not found or not owned by the actor.

---

### [LOW] `Number(process.env.JARVIS_WORKER_DB_POOL_SIZE ?? 4)` silently returns `NaN`

- **File:** `apps/worker/src/worker.ts:15`
- **Category:** TypeScript / Error Handling
- **Finding:** `Number("abc")` returns `NaN`. If `JARVIS_WORKER_DB_POOL_SIZE` is set to a non-numeric value, `maxConnections` becomes `NaN`, which Kysely/pg silently converts to an undefined or default pool size.
- **Evidence:**
  ```ts
  maxConnections: Number(process.env.JARVIS_WORKER_DB_POOL_SIZE ?? 4)
  ```
- **Impact:** Low in practice — an invalid env value causes an unpredictable pool size. But there is no validation or startup error that would alert an operator.
- **Recommendation:**
  ```ts
  const rawPoolSize = process.env.JARVIS_WORKER_DB_POOL_SIZE;
  const maxConnections = rawPoolSize ? parseInt(rawPoolSize, 10) : 4;
  if (isNaN(maxConnections) || maxConnections < 1) {
    throw new Error(`Invalid JARVIS_WORKER_DB_POOL_SIZE: "${rawPoolSize}"`);
  }
  ```

---

### [LOW] `JARVIS_WORKER_DB_POOL_SIZE` is undocumented in `env.production.example`

- **File:** `infra/env.production.example`; `apps/worker/src/worker.ts:15`
- **Category:** Quality
- **Finding:** `JARVIS_WORKER_DB_POOL_SIZE` is silently consumed in the worker but absent from `env.production.example`. Operators have no awareness of this tuning knob, and a production deployment with high job concurrency may be under-pooled (default 4 connections) without realising they can configure it.
- **Recommendation:** Add a commented entry to `env.production.example`:
  ```
  # Optional: worker DB connection pool size (default: 4). Increase if workers are queuing on DB connections.
  # JARVIS_WORKER_DB_POOL_SIZE=4
  ```

---

### [LOW] `LocalEmbeddingProvider` pipeline is lazy-initialized with no mutex — potential concurrent initialization

- **File:** `packages/memory/src/local-embedding-provider.ts`
- **Category:** Quality / Concurrency
- **Finding:** The `LocalEmbeddingProvider` initializes the `@huggingface/transformers` pipeline lazily on first `embedDocument` call. If multiple concurrent jobs trigger `embedDocument` simultaneously before the pipeline is initialized, two concurrent `getPipe()` calls will both enter the `if (!this.pipe)` branch and call `pipeline(...)` twice, racing to assign `this.pipe`. In Node.js this is unlikely to cause a crash (the second assignment simply overwrites the first), but it wastes resources loading the model twice and could cause issues if the Hugging Face loader is not safe for concurrent initialization.
- **Evidence:** (in `packages/memory/src/local-embedding-provider.ts`)
  ```ts
  private async getPipe(): Promise<ExtractPipe> {
    if (!this.pipe) {
      this.pipe = (await pipeline(...)) as ...;
    }
    return this.pipe;
  }
  ```
- **Impact:** In a high-throughput worker scenario, concurrent jobs embedding in parallel can race. The worker is currently single-threaded JavaScript so the race only manifests between microtask boundaries during `await pipeline(...)`.
- **Recommendation:** Use a promise-based singleton pattern:
  ```ts
  private pipePromise: Promise<ExtractPipe> | null = null;
  private getPipe(): Promise<ExtractPipe> {
    this.pipePromise ??= pipeline(...).then(p => p as ExtractPipe);
    return this.pipePromise;
  }
  ```

---

### [LOW] `formatToolSummary` has a dead branch — `visibleLabel` always `"visible"`

- **File:** `packages/briefings/src/repository.ts:386`
- **Category:** Quality
- **Finding:** The `visibleLabel` variable assigns `"visible"` for both the `=== 1` and the `else` branch.
- **Evidence:**
  ```ts
  const visibleLabel = tool.itemCount === 1 ? "visible" : "visible";
  ```
- **Impact:** Dead code and likely a copy-paste error. The ternary was probably intended to produce `"visible item"` vs `"visible items"`. The bug makes briefing output consistently use `"visible"` without the correct pluralization, which is a minor UX issue.
- **Recommendation:** Fix the ternary or remove it: `const visibleLabel = tool.itemCount === 1 ? "item" : "items";`.

---

### [INFO] `workspaces` and `instance_settings` tables do not have RLS enabled

- **File:** `infra/postgres/migrations/0004_auth_workspaces_settings.sql:86–92`
- **Category:** Security
- **Finding:** `app.workspaces` and `app.instance_settings` are granted SELECT to `jarvis_worker_runtime` but have no RLS policy (`ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY` appear nowhere for these tables). This means the worker can SELECT all workspaces and all instance settings without any row-level filtering.
- **Evidence:**
  ```sql
  GRANT SELECT
    ON app.workspaces, app.instance_settings
    TO jarvis_worker_runtime;
  -- No ENABLE ROW LEVEL SECURITY on either table
  ```
- **Impact:** The worker currently uses these tables for configuration lookups (e.g., module availability checks in briefings). Since the worker operates scoped per-actor, reading all workspace rows is not currently exploitable for cross-user data leakage. However, the absence of RLS is a gap in the defense-in-depth posture — if a future query mistakenly uses workspace data to scope user results, there is no DB-level firewall. `instance_settings` especially is a system-wide configuration store and should be read-only at the DB level for the worker role, which it is (SELECT only), but RLS would provide an additional layer.
- **Recommendation:** Not necessarily a blocker for the worker scope specifically, but the existing audit of RLS coverage (Phase 1) should flag this gap. These are non-user-owned tables by design (they are shared infrastructure), so adding RLS would require a non-owner-scoped policy (e.g., `FOR ALL TO jarvis_worker_runtime USING (true)`), which is permissive but at least ensures the table is under the RLS audit boundary.

---

### [INFO] `pg-boss` schema tables have no RLS — job payloads visible across roles

- **File:** `infra/postgres/grants/0001_pgboss_runtime_grants.sql`
- **Category:** Security
- **Finding:** Both `jarvis_app_runtime` and `jarvis_worker_runtime` hold `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss`. There is no RLS on the pgboss schema tables. This means the app runtime can read all job payloads queued by any actor, including job IDs and `actorUserId` fields of other users' pending jobs.
- **Evidence:**
  ```sql
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss
    TO jarvis_app_runtime, jarvis_worker_runtime;
  ```
- **Impact:** pg-boss requires unrestricted access to its own schema tables to function — it is not feasible to apply per-row RLS to pg-boss's internal tables without patching pg-boss. The correct mitigation is ensuring payloads remain metadata-only (which is partially enforced). This is an architectural note, not an actionable code fix.
- **Recommendation:** Accept this as a known architectural constraint. The payload metadata-only invariant is the primary mitigation. Ensure this is documented in the security model.

---

### [INFO] `extractFactsJob` handler is a permanent no-op — registered worker consumes queue capacity for no work

- **File:** `packages/chat/src/jobs.ts:104–111`
- **Category:** Quality
- **Finding:** The `handleExtractFactsJob` function does nothing — it is a declared stub with a TODO comment that reads "TODO(phase3-facts)". The worker registers a handler for `chat.extract-facts` queue and the queue definition is created during migration, but every job dispatched to it is silently consumed and returns `void`. This is not a bug in isolation, but combined with the `retryLimit: 2` setting, failed dispatches will retry 3 times before being abandoned, consuming polling capacity for zero outcome.
- **Evidence:**
  ```ts
  export async function handleExtractFactsJob(
    _scopedDb: DataContextDb,
    _ownerUserId: string,
    _threadId: string
  ): Promise<void> {
    // TODO(phase3-facts): call capability router to extract structured facts
  }
  ```
- **Impact:** No security or correctness impact. Queue overhead is minimal. The issue is that jobs are silently dropped rather than being nacked or skipped, which makes observability difficult — an operator monitoring the `chat.extract-facts` queue would see 100% success with zero actual work done.
- **Recommendation:** Until phase3-facts is implemented, either: (a) do not dispatch to `chat.extract-facts` at the send site, or (b) add a comment to the queue registration noting it is intentionally a no-op, or (c) return an explicit skipped result rather than `void`.

---

### [INFO] Module registry `registerBuiltInModuleWorkers` uses `Promise.all` — one registration failure cancels all workers

- **File:** `packages/module-registry/src/index.ts:202–212`
- **Category:** Error Handling
- **Finding:** `registerBuiltInModuleWorkers` uses `Promise.all` to register all module workers in parallel. If any single module's `registerWorkers` call throws (e.g., a queue configuration error for one module), `Promise.all` rejects and none of the already-registered workers are cleaned up. The worker process then exits (via `unhandledRejection` → `handleCrash`) with all queues unlistened.
- **Evidence:**
  ```ts
  const workerIds = await Promise.all(
    BUILT_IN_MODULES.map(
      (module) => module.registerWorkers?.(boss, dependencies) ?? Promise.resolve([])
    )
  );
  ```
- **Impact:** In a partial-failure scenario (e.g., one module's queue does not exist in pgboss), the entire worker process exits. This is probably acceptable as a fail-fast approach, but it means a single misconfigured module takes down all job processing. `Promise.allSettled` with explicit per-module failure logging would be more resilient.
- **Recommendation:** Consider `Promise.allSettled` with structured error logging per module failure, allowing healthy modules to continue processing jobs.

---

## Cross-Cutting Notes for the Worker Surface

1. **`DataContextRunner` transaction scope is correct.** Every job handler — without exception — reaches the DB through `registerDataContextWorker`, which calls `withDataContext`, which wraps everything in a single Kysely transaction with `set_config` scoping. The multi-step writes in briefings (`INSERT briefing_runs` + `UPDATE briefing_definitions`) and tasks (`updateStatus` + cascade + recurrence) are all within this transaction and will roll back atomically on failure. This is a genuine strength.

2. **Module isolation is clean at the handler layer.** No job handler imports another module's internals. `chat/jobs.ts` importing `@jarv1s/memory` is expected (memory is the dependency of chat embedding). `briefings/repository.ts` importing `findAssistantToolFromManifests` from `@jarv1s/ai` is a legitimate public-API import (the function is exported from the ai package's public index). No handler bypasses RLS or queries another module's tables directly.

3. **pg-boss role grants are correct.** `jarvis_worker_runtime` carries `NOBYPASSRLS` in the bootstrap SQL and receives only the grants it needs. The auth tables (`auth_accounts`, `better_auth_sessions`, `auth_sessions`) have been explicitly revoked from `jarvis_worker_runtime` by migrations 0045 and 0046. This is well-structured.

4. **Shutdown race condition.** Both `SIGINT` and `SIGTERM` handlers call `void shutdown().then(() => process.exit(0))` — the `void` discards any error from `shutdown()`. If `boss.stop` rejects, the process still exits with code 0, making monitoring systems believe shutdown was clean. The `void` should be replaced with `.catch(err => { console.error(...); process.exit(1); })`.
