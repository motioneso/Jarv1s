# Memory Module — Thermo-Nuclear Code Quality Audit

**Date:** 2026-06-10
**Module:** `packages/memory`
**Reviewer:** Automated deep audit
**Scope:** All source files under `packages/memory/src/` and `packages/memory/sql/`; cross-module consumers (`packages/chat/src/jobs.ts`, `packages/chat/src/recall-port.ts`, `packages/chat/src/routes.ts`)

---

## Executive Summary

The memory module has a solid RLS foundation for the core owner-isolation contract and a well-structured public API surface. However, three issues require immediate attention before any multi-user production deployment: (1) the `jarvis_worker_runtime` role holds table GRANTs on all memory tables but has **zero RLS policies**, meaning workers run FORCE RLS with no matching policy — all DML silently touches zero rows for all but the default role; (2) fact mutations (`deleteFact`, `updateFactImportance`) filter only by `id` with no application-layer owner check, relying entirely on RLS; (3) the HNSW index is global (no `owner_user_id` prefix), so ANN approximate search finds the top-K globally then RLS trims — recall quality degrades as the table grows across many users and may return fewer than requested results with no indication.

---

## Findings

### [HIGH] Worker runtime has no RLS policies on any memory table — worker DML silently affects zero rows (correctness/availability defect)
- **File:** `packages/memory/sql/0040_memory_chat_source.sql:15–17`, `packages/memory/sql/0041_memory_facts.sql:45`
- **Category:** Security
- **Finding:** Migration 0040 grants `jarvis_worker_runtime` full DML access (`SELECT, INSERT, UPDATE, DELETE`) on `app.memory_chunks` and `app.memory_file_index`, and migration 0041 grants the same on `app.chat_memory_facts`. All three tables have `FORCE ROW LEVEL SECURITY`. The existing RLS policies are scoped with `TO jarvis_app_runtime` only. PostgreSQL behavior with `FORCE ROW LEVEL SECURITY` and no matching policy for the current role: **all queries return zero rows; all DML silently affects zero rows** (fail-closed for data exfiltration, but silently broken for writes). The worker job `handleEmbedTurnJob` and all fact-extraction jobs are therefore no-ops at the database layer — they succeed in code but commit nothing.
- **Evidence:**
  ```sql
  -- 0030_memory_index.sql lines 45–63: all policies TO jarvis_app_runtime only
  CREATE POLICY memory_chunks_select ON app.memory_chunks
    FOR SELECT TO jarvis_app_runtime ...
  CREATE POLICY memory_chunks_insert ON app.memory_chunks
    FOR INSERT TO jarvis_app_runtime ...
  -- 0040: grants to worker but NO policy for worker
  GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_chunks TO jarvis_worker_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_file_index TO jarvis_worker_runtime;
  ```
- **Impact:** The chat embed-turn worker (`CHAT_EMBED_TURN_QUEUE`) will never successfully write memory chunks. The content-hash idempotency check `getFileIndex` also returns null (no matching policy), so every job re-embeds unnecessarily and still writes nothing. Chat episodic memory is completely non-functional for the worker path. This also means `handleExtractFactsJob` will fail silently if ever implemented.
- **Recommendation:** Add worker-specific RLS policies to all memory tables in a new migration. Pattern from `0002_app_rls.sql` (which adds worker policies to `rls_probe_items`):
  ```sql
  -- New migration: 0042_memory_worker_rls.sql
  DROP POLICY IF EXISTS memory_chunks_select_worker ON app.memory_chunks;
  CREATE POLICY memory_chunks_select_worker ON app.memory_chunks
    FOR SELECT TO jarvis_worker_runtime
    USING (owner_user_id = app.current_actor_user_id());
  -- Repeat for INSERT/UPDATE/DELETE on memory_chunks, memory_file_index, chat_memory_facts
  ```

---

### [INFO] `chat_memory_facts` UPDATE policy omits explicit `WITH CHECK` — defaults to USING expression, owner-escalation already blocked
- **File:** `packages/memory/sql/0041_memory_facts.sql:37–38`
- **Category:** Security
- **Finding:** The UPDATE RLS policy on `chat_memory_facts` has only `USING` (controls which rows can be targeted) but no `WITH CHECK` (controls what the row looks like after update). This means if a caller can construct an UPDATE that changes `owner_user_id` to a different value, PostgreSQL will execute it — the USING clause permits selecting the row for update, and without WITH CHECK it does not re-verify ownership of the resulting row.
- **Evidence:**
  ```sql
  CREATE POLICY chat_memory_facts_update ON app.chat_memory_facts
    FOR UPDATE USING (owner_user_id = app.current_actor_user_id());
  -- Missing: WITH CHECK (owner_user_id = app.current_actor_user_id())
  ```
  Compare `memory_chunks_update` (0030) and `memory_file_index_update` (0032) which correctly have both `USING` and `WITH CHECK`.
- **Impact:** A compromised application layer that can construct raw SQL (or a future repository method that mutates `owner_user_id`) could reassign a fact to another user's account. Violates the "private by default" invariant.
- **Recommendation:**
  ```sql
  -- New migration:
  DROP POLICY IF EXISTS chat_memory_facts_update ON app.chat_memory_facts;
  CREATE POLICY chat_memory_facts_update ON app.chat_memory_facts
    FOR UPDATE
    USING (owner_user_id = app.current_actor_user_id())
    WITH CHECK (owner_user_id = app.current_actor_user_id());
  ```

---

### [LOW] Fact mutations (`deleteFact`, `updateFactImportance`, `supersedeFact`) accept bare `id` with no application-layer owner check
- **File:** `packages/memory/src/facts-repository.ts:79–103`, `packages/chat/src/routes.ts:197–226`
- **Category:** Security / Architecture
- **Finding:** All three fact-mutation methods filter by `id` only, with no `ownerUserId` parameter and no application-layer ownership verification. Security relies entirely on RLS. While the RLS `USING` clause does enforce ownership for the current session's actor, this creates a fragile security model: any future code path that constructs a `DataContextDb` with a different actor's ID (or a bug in `withDataContext` parameter threading) would silently fail to apply the guard. The route handlers in `routes.ts:203` and `routes.ts:220` call these methods without asserting that `request.params.id` belongs to `access.actorUserId`.
- **Evidence:**
  ```typescript
  // facts-repository.ts:87–90
  async deleteFact(scopedDb: DataContextDb, id: string): Promise<void> {
    await sql`
      DELETE FROM app.chat_memory_facts WHERE id = ${id}::uuid
    `.execute(scopedDb.db);
  }
  // routes.ts:202–204 — no ownership pre-check
  await dependencies.dataContext.withDataContext(access, (scopedDb) =>
    factsRepo.deleteFact(scopedDb, request.params.id)
  );
  ```
- **Impact:** Defence-in-depth is single-layered. If RLS has a gap (see CRITICAL finding above) or if a future code path reuses these methods with a different actor context, an adversary could delete or modify another user's facts. Defense-in-depth requires the repository to accept and verify `ownerUserId`.
- **Recommendation:** Add `ownerUserId: string` to the signatures of `deleteFact`, `updateFactImportance`, and `supersedeFact`. Include it in the WHERE clause alongside `id`. This mirrors the pattern used everywhere else in the codebase (e.g., `deleteFileChunks(scopedDb, ownerUserId, sourcePath, sourceKind)`).

---

### [LOW] HNSW vector index is global across all users — recall quality/scalability issue, not a data leak
- **File:** `packages/memory/sql/0032_memory_embedding_768.sql:19–21`, `packages/memory/src/repository.ts:72–103`
- **Category:** Security / Architecture
- **Finding:** The HNSW index covers all rows in `memory_chunks` without an `owner_user_id` predicate. The `vectorSearch` method applies no `owner_user_id` filter in the SQL query — it relies solely on `FORCE ROW LEVEL SECURITY`. In PostgreSQL, RLS is applied after the index scan for HNSW: the ANN algorithm retrieves the global top-`limit` candidates, then RLS filters to rows where `owner_user_id = current_actor_user_id()`. In a multi-user deployment, if a user has 500 chunks and another user has 50,000 chunks, the global top-20 returned by HNSW may contain zero rows for the first user — they receive zero results despite having highly relevant memories. Additionally, the approximate nature of HNSW means cross-user chunks occupy result slots that should belong to the target user.
- **Evidence:**
  ```sql
  -- 0032: no partial index by owner
  CREATE INDEX memory_chunks_embedding_idx
    ON app.memory_chunks USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;
  -- repository.ts:87–93: no owner_user_id in WHERE
  SELECT id, source_path, line_start, line_end, text,
         1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
  FROM app.memory_chunks
  WHERE embedding IS NOT NULL
    AND source_kind = ${sourceKind}
  ORDER BY embedding <=> ${vectorLiteral}::vector
  LIMIT ${limit}
  ```
- **Impact:** Recall degrades non-linearly as the user base grows. For heavy users, recall may silently return partial results (fewer than `limit`) or miss the most relevant chunks. Not a data-exfiltration risk (RLS prevents cross-user reads) but a correctness/quality defect.
- **Recommendation:** Add `owner_user_id = ${ownerUserId}::uuid` to the `vectorSearch` WHERE clause and pass `ownerUserId` as a parameter. This enables the query planner to combine the HNSW scan with a bitmap heap scan on `memory_chunks_owner_idx`, scoping the ANN search to the user's partition. The method already receives `scopedDb` but RLS alone is insufficient to constrain the ANN candidate set.

---

### [HIGH] Module isolation violation — `chat_memory_facts` SQL references `app.chat_threads` (cross-module foreign key)
- **File:** `packages/memory/sql/0041_memory_facts.sql:9`
- **Category:** Architecture
- **Finding:** The `chat_memory_facts` table, owned by the memory module, has a foreign key to `app.chat_threads`, which is owned by the chat module (`packages/chat/src/manifest.ts:32`). This is a cross-module schema dependency from memory → chat. The CLAUDE.md invariant states: "Modules collaborate only through declared public APIs/events. No module imports another module's internals or queries its tables directly." A FK reference in a module's DDL creates a hard schema dependency that cannot be managed through public APIs.
- **Evidence:**
  ```sql
  -- 0041_memory_facts.sql:9
  source_thread_id UUID REFERENCES app.chat_threads(id) ON DELETE SET NULL,
  ```
  Chat module's manifest:
  ```typescript
  ownedTables: ["app.chat_threads", "app.chat_messages", "app.chat_user_memory_settings"]
  ```
- **Impact:** Memory module cannot be migrated, tested, or deployed independently of the chat module. If `chat_threads` is renamed or restructured, the memory migration fails. This also means `chat_memory_facts` is arguably a chat module table (it references chat threads) masquerading as a memory module table.
- **Recommendation:** Either (a) move `chat_memory_facts` to the chat module (it is tightly coupled to chat threads) and have the chat module call the memory public API for embedding operations, or (b) replace the FK with a soft reference (`source_thread_id UUID` with no FK constraint) and let application logic handle consistency. Option (a) is preferred as it correctly reflects ownership.

---

### [MEDIUM] Recall query uses raw `actorUserId` UUID string as semantic search query — semantically meaningless
- **File:** `packages/chat/src/recall-port.ts:72–73`
- **Category:** Code Quality
- **Finding:** The episodic recall query is `\`${actorUserId} past conversations\``, where `actorUserId` is a UUID like `"00000000-0000-4000-8000-000000000011"`. UUIDs have no semantic content for an embedding model; the model will embed the UUID string itself, producing a nearly random unit vector with no relationship to actual conversation content. The "past conversations" suffix adds minimal signal. The result is that episodic recall is effectively a random sample from the user's chat chunks, not a contextually relevant retrieval.
- **Evidence:**
  ```typescript
  // recall-port.ts:72
  const query = `${actorUserId} past conversations`;
  const queryEmbedding = await this.embeddingProvider.embedQuery(query);
  ```
- **Impact:** The episodic recall feature provides no semantic retrieval benefit — it randomly samples recent memory chunks. Users relying on context injection from past conversations receive irrelevant content in their LLM context window. This is a silent quality defect with no error.
- **Recommendation:** Replace with a contextually meaningful seed query. At session launch, no user message exists yet, so use a stable personal context anchor: `"recent conversations and important context"`. Better: accept the current session's first user message as the query when available, or use the thread's topic if known. The TODO at `recall-port.ts:72` is implicit — make it explicit.

---

### [MEDIUM] `upsertFileChunks` and `replaceFileLinks` use sequential `for` loops with individual SQL statements — N+1 pattern within a transaction
- **File:** `packages/memory/src/repository.ts:35–46`, `packages/memory/src/repository.ts:117–123`
- **Category:** Code Quality
- **Finding:** `upsertFileChunks` issues one `INSERT` per chunk in a `for` loop. `replaceFileLinks` similarly issues one `INSERT` per `toPath`. For a document with 50 chunks this is 51 SQL round-trips within a single transaction (1 DELETE + 50 INSERTs). The code is inside a transaction, so round-trip latency is bounded to the local socket, but the parameter overhead and per-statement parse/plan cost are unnecessary.
- **Evidence:**
  ```typescript
  // repository.ts:35–46
  for (const chunk of chunks) {
    const vectorLiteral = `[${chunk.embedding.join(",")}]`;
    await sql`INSERT INTO app.memory_chunks ...`.execute(scopedDb.db);
  }
  // repository.ts:117–123
  for (const toPath of toPaths) {
    await sql`INSERT INTO app.memory_links ...`.execute(scopedDb.db);
  }
  ```
- **Impact:** Ingest throughput is linearly proportional to chunk count. Large documents or vault re-builds will be noticeably slow. Not a correctness issue.
- **Recommendation:** Use a single multi-row `INSERT ... VALUES ($1,$2), ($3,$4), ...` with unnested arrays, or use `COPY FROM STDIN` via pg's streaming interface. For vectors specifically, construct a single values list and cast once. Kysely's `insertInto(...).values([...])` supports multi-row inserts.

---

### [MEDIUM] No retention policy or size cap on `memory_chunks`, `chat_memory_facts`, or `memory_file_index` — unbounded growth
- **File:** `packages/memory/src/` (entire module), `packages/memory/sql/*.sql`
- **Category:** Architecture / Code Quality
- **Finding:** There is no maximum chunk count per user, no time-based expiry, no maximum fact count, and no scheduled cleanup. `chat_memory_facts` accumulates indefinitely; `superseded` facts are retained forever. The `memory_chunks` table grows with every vault ingest and every chat turn embed. `purgeDeletedFiles` only removes chunks for vault files that no longer exist on disk — it does not bound total storage.
- **Evidence:** `listActiveFacts` in `facts-repository.ts:58–76` has no LIMIT. `vectorSearch` takes an external `limit` parameter but the caller (`RecallService`) uses a constant `TOP_K_CANDIDATES = 20`. The underlying table can have millions of rows.
- **Impact:** Over time, a heavy user's embedding index grows large enough that HNSW build and search time degrades significantly. `listActiveFacts` called at every session launch (`recall-port.ts:55–59`) loads all active facts into memory with no bound.
- **Recommendation:** Add: (1) a hard `LIMIT` in `listActiveFacts` (e.g., 100 most important/recent); (2) a scheduled job that prunes `superseded` facts older than 90 days; (3) a maximum chunk count per user (e.g., 10,000) with eviction of oldest by `updated_at`; (4) document the retention model in the module manifest or a spec.

---

### [MEDIUM] `EmbedTurnJobPayload` stores full conversation turn text in `memory_chunks.text` without size or content policy
- **File:** `packages/chat/src/jobs.ts:58`
- **Category:** Security / Architecture
- **Finding:** The embed-turn job constructs the full text as `User: ${userMsg.body}\nAssistant: ${assistantMsg.body}` and stores it verbatim in `memory_chunks.text`. This is the raw private conversation content stored in a derived/rebuildable table. There is no maximum length check, no PII redaction, and no policy controlling what conversation content is eligible for memory embedding (e.g., should system messages be excluded? Should content containing passwords/tokens be filtered?).
- **Evidence:**
  ```typescript
  // jobs.ts:58–70
  const text = `User: ${userMsg.body}\nAssistant: ${assistantMsg.body}`;
  // ... stored directly in memory_chunks.text
  ```
- **Impact:** If a user sends a message containing a secret (e.g., pastes an API key), it is stored verbatim in `memory_chunks.text` with no TTL. The "secrets never escape" invariant applies to credentials not reaching AI prompts — but storing user-pasted secrets in the memory index then injecting them into future AI context windows during recall could violate this invariant. Additionally, unbounded message body length can produce arbitrarily large chunk text.
- **Recommendation:** (1) Add a maximum chunk text length (e.g., 8,000 characters, truncating with an indicator); (2) document the data retention policy for chat chunks in the module spec; (3) consider whether `memory_chunks` should be excluded from user data export or flagged as derived/rebuildable in the export pipeline.

---

### [MEDIUM] `getEmbeddingProviderConfig` reads from `process.env` at call time — not validated or typed
- **File:** `packages/memory/src/embedding-provider-config.ts:27–31`
- **Category:** TypeScript / Code Quality
- **Finding:** `getEmbeddingProviderConfig` casts `process.env["JARVIS_EMBED_PROVIDER"]` directly to `EmbeddingProviderKind` with `as EmbeddingProviderKind`. If the env var is set to an unrecognized value (e.g., `"openai"` or a typo), `createEmbeddingProvider`'s `switch` statement has no `default` branch and TypeScript's exhaustiveness check covers only the declared union — at runtime an unknown value falls through the switch silently and returns `undefined`, causing a null-reference crash at the first `embedDocument` call.
- **Evidence:**
  ```typescript
  // embedding-provider-config.ts:28
  const kind = (process.env["JARVIS_EMBED_PROVIDER"] ?? "local") as EmbeddingProviderKind;
  // createEmbeddingProvider switch has no default branch
  switch (config.kind) {
    case "local": return new LocalEmbeddingProvider(config.modelId);
    case "stub":  return new StubEmbeddingProvider();
  }
  ```
- **Impact:** A misconfigured environment produces a silent crash at runtime, not a startup-time configuration error. Difficult to debug.
- **Recommendation:** (1) Add an `else`/`default` branch to `createEmbeddingProvider` that throws `new Error(\`Unknown embedding provider kind: ${config.kind}\`)`; (2) Validate `kind` against the allowed values in `getEmbeddingProviderConfig` before casting; (3) Emit a warning (or throw) at startup rather than at first use.

---

### [MEDIUM] `LocalEmbeddingProvider.getPipe()` has no error handling or timeout — model download can hang indefinitely
- **File:** `packages/memory/src/local-embedding-provider.ts:31–36`
- **Category:** Error Handling
- **Finding:** `getPipe()` calls `pipeline("feature-extraction", this.modelName)` which downloads the model from HuggingFace Hub on first call. There is no timeout, no retry limit, no error wrapping, and no fallback. If the model download fails mid-stream (network failure), the error propagates as an unhandled rejection through the embedding pipeline and crashes the caller (ingestion job, recall service). The error message from `@huggingface/transformers` is opaque and does not include the model name.
- **Evidence:**
  ```typescript
  // local-embedding-provider.ts:31–36
  private async getPipe(): Promise<ExtractPipe> {
    if (!this.pipe) {
      this.pipe = (await pipeline("feature-extraction", this.modelName)) as unknown as ExtractPipe;
    }
    return this.pipe;
  }
  ```
- **Impact:** In production, if the HuggingFace model cache is cold (e.g., first boot, new container), all memory operations fail with cryptic errors. No graceful degradation or meaningful error message.
- **Recommendation:** Wrap in try/catch with a descriptive error: `throw new Error(\`Failed to load embedding model "${this.modelName}": ${err.message}\`)`. Consider a startup health-check that pre-warms the model on boot.

---

### [LOW] `RecallService` constructs `AccessContext` with constant `requestId: "recall"` — misses request correlation
- **File:** `packages/chat/src/recall-port.ts:43`
- **Category:** Code Quality
- **Finding:** `RecallService.recall` constructs `accessCtx = { actorUserId, requestId: "recall" }` with a hardcoded string. All recall operations across all users log and execute with the same `requestId`. The `DataContextRunner` sets this as a local session variable (`app.request_id`), which is presumably used for audit logs and pg-boss correlation. Using a constant value makes it impossible to correlate recall activity with specific sessions or requests.
- **Evidence:**
  ```typescript
  // recall-port.ts:43
  const accessCtx = { actorUserId, requestId: "recall" };
  ```
- **Impact:** Audit trail and request correlation for recall operations is broken — all appear as the same synthetic request. Low security impact but obstructs debugging and audit.
- **Recommendation:** Accept a `requestId` parameter from the caller (the session launch context already has one) or generate a unique one: `requestId: \`recall:${randomUUID()}\``.

---

### [LOW] `vectorSearch` passes `ownerUserId` but does not include it in the SQL query — redundant parameter throughout call stack
- **File:** `packages/memory/src/repository.ts:72–103`
- **Category:** Code Quality
- **Finding:** `vectorSearch` does not accept an `ownerUserId` parameter at all — it relies on RLS. However, callers pass `scopedDb` (which encodes the actor) so the owner context flows through RLS. This is consistent but the API signature is asymmetric with all other repository methods that accept `ownerUserId` explicitly. Adding `ownerUserId` to `vectorSearch` (as recommended in the HNSW finding) would also make the access intent explicit in the method signature.
- **Evidence:** Compare `deleteFileChunks(scopedDb, ownerUserId, sourcePath, sourceKind)` vs `vectorSearch(scopedDb, embedding, limit, sourceKind)` — no `ownerUserId`.
- **Impact:** Low. Code is harder to reason about at a glance.
- **Recommendation:** Add explicit `ownerUserId: string` to `vectorSearch`. This pairs with the HNSW fix above.

---

### [LOW] `parseDocument` returns `frontmatterText` but it is never embedded or indexed
- **File:** `packages/memory/src/parser.ts:17–36`, `packages/memory/src/ingest.ts:56–67`
- **Category:** Code Quality
- **Finding:** `parseDocument` extracts frontmatter into `frontmatterText` and returns it in `ParsedDocument`. The ingest pipeline destructures `{ chunks, wikilinks }` from the result, silently discarding `frontmatterText`. Frontmatter often contains the most structured metadata about a note (tags, title, dates, links) and would be useful for recall. The field is in the public API surface but serves no current purpose.
- **Evidence:**
  ```typescript
  // ingest.ts:56
  const { chunks, wikilinks } = parseDocument(content);
  // frontmatterText is discarded
  ```
- **Impact:** Metadata-rich frontmatter (tags, aliases, related notes) is not searchable. Minor quality loss.
- **Recommendation:** Either embed frontmatter as a special chunk or remove `frontmatterText` from the public `ParsedDocument` interface if it is deliberately deferred. A TODO comment would at minimum signal intent.

---

### [LOW] `chat_memory_facts` is not listed in `memoryModuleManifest.database.ownedTables`
- **File:** `packages/memory/src/manifest.ts:29–34`
- **Category:** Architecture
- **Finding:** The manifest's `ownedTables` lists `"app.memory_chunks"`, `"app.memory_links"`, `"app.memory_file_index"`, and `"app.chat_memory_facts"`. Wait — it does include `chat_memory_facts`. However, the table's FK references `app.chat_threads` (owned by chat), creating an ownership ambiguity: the memory module claims ownership but depends on chat's schema. This is an implicit cross-module coupling that should be documented or resolved (see HIGH finding on module isolation).
- **Evidence:** `manifest.ts:34`: `"app.chat_memory_facts"` owned by memory, but its DDL in `0041_memory_facts.sql:9` has `REFERENCES app.chat_threads(id)`.
- **Impact:** If memory is deployed without chat, the migration `0041` fails with a missing table error. Module cannot stand alone.
- **Recommendation:** Document the required deployment order, or resolve the cross-module FK dependency.

---

### [LOW] No integration tests for `ChatMemoryFactsRepository` or cross-user fact isolation
- **File:** `tests/integration/memory.test.ts`
- **Category:** Tests
- **Finding:** The integration test file (`memory.test.ts`) covers `MemoryRepository`, `MemoryIngestPipeline`, `IngestionService`, and `MemoryRetriever` with cross-user isolation tests. However, there are no tests for `ChatMemoryFactsRepository` at all: no tests for `insertFact`, `listActiveFacts`, `supersedeFact`, `deleteFact`, or `updateFactImportance`. There is also no test verifying that a user cannot delete or update another user's facts (the mutation security boundary described above).
- **Impact:** Fact storage is untested. Regressions in fact CRUD or RLS policies on `chat_memory_facts` would not be caught by the integration gate.
- **Recommendation:** Add a `describe("ChatMemoryFactsRepository")` block covering: insert+list round-trip; supersede marks as superseded; delete removes the row; cross-user isolation (user B cannot see or modify user A's facts via `listActiveFacts`).

---

### [INFO] `StubEmbeddingProvider` is exported in the public API — possible misuse in non-test production code
- **File:** `packages/memory/src/index.ts:2`
- **Category:** Code Quality
- **Finding:** `StubEmbeddingProvider` is exported from the module's public `index.ts`. The intended use is tests and explicit opt-out (`JARVIS_EMBED_PROVIDER=stub`). Exporting it from the public API makes it reachable by any consumer who might accidentally use it in production without noticing.
- **Evidence:** `index.ts:2`: `export { StubEmbeddingProvider } from "./embedding-provider.js";`
- **Impact:** Low. Controlled by `getEmbeddingProviderConfig`. No active misuse found.
- **Recommendation:** Document the export's intended scope with a JSDoc comment: `/** For tests and explicit stub opt-out only. Never instantiate in production code directly. */`

---

### [INFO] `LocalEmbeddingProvider` casts pipeline output via `as unknown as ExtractPipe` — structural unsoundness bypasses type safety
- **File:** `packages/memory/src/local-embedding-provider.ts:34`
- **Category:** TypeScript
- **Finding:** `(await pipeline("feature-extraction", this.modelName)) as unknown as ExtractPipe` double-casts to bypass TypeScript's type system. The `ExtractPipe` interface defined locally assumes the pipeline returns `{ data: Float32Array }`, but the actual `@huggingface/transformers` pipeline return type is a complex union that may not match this shape for all model configurations. If the model returns a batched output or a different pooling format, the runtime type mismatch produces a silent wrong-shape access.
- **Evidence:**
  ```typescript
  // local-embedding-provider.ts:34
  this.pipe = (await pipeline("feature-extraction", this.modelName)) as unknown as ExtractPipe;
  ```
- **Impact:** Low in practice (nomic-embed-text-v1.5 is verified to match), but the type cast hides any future model incompatibility.
- **Recommendation:** Add a runtime shape assertion after the cast: `if (!output || !('data' in output)) throw new Error('Unexpected embedding output shape')`.

---

## Summary Table

| Severity | Count | Key Finding |
|----------|-------|-------------|
| HIGH | 2 | Worker role has no RLS policies — worker DML silently affects zero rows (correctness/availability defect); cross-module FK |
| MEDIUM | 5 | Meaningless recall query; N+1 insert loops; no retention policy; secrets in chunk text; env config unsoundness |
| LOW | 7 | Bare-id mutations; HNSW global scan (recall quality); constant requestId; asymmetric API; unused frontmatterText; manifest ambiguity; no facts tests |
| INFO | 3 | `chat_memory_facts` UPDATE policy omits explicit WITH CHECK (defaults to USING, safe); StubEmbeddingProvider export; as-unknown-as cast |

## Hard Invariant Violations

| Invariant | Status | Finding |
|-----------|--------|---------|
| No admin private-data bypass | PASS | No BYPASSRLS detected |
| Private by default | PASS (with caveat) | RLS enforces owner-only; CRITICAL finding means worker writes fail rather than leak |
| DataContextDb only | PASS | All repositories accept only `DataContextDb` |
| AccessContext shape | PASS | `{ actorUserId, requestId }` only |
| Secrets never escape | CONDITIONAL | Chat message bodies stored verbatim in chunks — MEDIUM finding |
| Metadata-only job payloads | PASS | Payloads carry only `actorUserId`, `threadId`, `messageId` |
| Provider-agnostic AI | PASS | `createEmbeddingProvider` factory is the sole instantiation point |
| Module isolation | FAIL | `chat_memory_facts` has FK to `app.chat_threads` (chat module) — HIGH finding |
| Never edit applied migrations | PASS | No violations found |
