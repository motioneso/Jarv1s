## Phase 6 — Module Data Layer (tasks, memory, vault content, structured-state)

**Model:** claude-sonnet-4-6
**Date:** 2026-06-10
**Scope:** Repository classes, SQL migrations, RLS policies, pg-boss payloads, and vault I/O for the tasks, memory, structured-state, and vault packages. Integration test coverage gaps also reviewed.

---

### Severity counts

- CRIT: 0
- HIGH: 2
- MED: 3
- LOW: 2
- INFO: 3

---

### Findings

#### [HIGH] `jarvis_worker_runtime` has table grants but no RLS policies on `memory_chunks` and `memory_file_index`

**File:** `packages/memory/sql/0040_memory_chat_source.sql:15-16`
**Invariant violated / concern:** FORCE RLS is active on both tables. The existing RLS policies (from `0030_memory_index.sql` and `0032_memory_embedding_768.sql`) are all scoped `TO jarvis_app_runtime`. Migration `0040` adds `GRANT … TO jarvis_worker_runtime` but adds no corresponding policies. Under FORCE RLS, a role with grants but no matching policy is denied all rows. This means the chat embed worker (`chat.embed-turn` queue) will be silently rejected when it tries to write memory chunks — effectively breaking the entire episodic memory write path for the worker. The `memory_links` SELECT grant for the worker also has no policy backing it.
**Detail:** `registerChatJobWorkers` in `packages/chat/src/jobs.ts` calls `memoryRepository.upsertFileChunks` and `upsertFileIndex` from within a worker context. The worker uses `jarvis_worker_runtime`. No `TO jarvis_worker_runtime` clause exists on any `memory_chunks` or `memory_file_index` policy. Result: every INSERT/UPDATE/DELETE issued by the worker is rejected by the RLS default-deny. The failure is silent from the caller's perspective (no exception — the affected-row count is 0), so data is silently lost rather than loudly failing.
**Suggested fix:** Add `TO jarvis_app_runtime, jarvis_worker_runtime` (or a separate matching policy) to the `memory_chunks_select`, `memory_chunks_insert`, `memory_chunks_update`, `memory_chunks_delete`, `memory_file_index_select`, `memory_file_index_insert`, `memory_file_index_update`, `memory_file_index_delete` policies. Add a new migration file for this change; never edit the applied `0030` or `0032` files.

---

#### [HIGH] `structured-state` repositories accept caller-supplied `ownerUserId` on INSERT without asserting it equals `actorUserId`

**File:** `packages/structured-state/src/commitments-repository.ts:26-42`, `packages/structured-state/src/entities-repository.ts:25-40`, `packages/structured-state/src/preferences-repository.ts:5-23`
**Invariant violated / concern:** The "private by default" and "actorUserId sourced from AccessContext only" invariants. All three repository `create`/`upsert` methods accept an `ownerUserId` string in their input object and write it verbatim to the `owner_user_id` column. The RLS `WITH CHECK` policy does enforce `owner_user_id = app.current_actor_user_id()` at the DB layer (so a mismatch will raise a policy violation), but there is no application-layer guard asserting the two match before the query is issued. Any caller that erroneously passes a different `ownerUserId` will get a cryptic RLS policy violation rather than a clear invariant error, and — more critically — if a future caller receives the `ownerUserId` from a request body rather than the `AccessContext`, the DB layer becomes the only defense.
**Detail:** By contrast, `tasks/src/repository.ts` sets `owner_user_id: sql\`app.current_actor_user_id()\`` directly, never accepting it as an input field. The structured-state repositories follow a looser pattern. The current callers in tests always pass `userId` sourced from a constant, but there is no route-layer guard preventing a malicious `ownerUserId` in a future route. The `PreferencesRepository.get` and `list` methods do not accept `ownerUserId` at all (they rely solely on RLS) but `upsert` accepts it.
**Suggested fix:** Remove `ownerUserId` from `CreateCommitmentInput`, `CreateEntityInput`, and the `PreferencesRepository.upsert` signature. Replace the literal insert value with `sql\`app.current_actor_user_id()\`` (following the tasks module pattern). This makes the application layer as robust as the DB layer and eliminates the class of accidental/malicious owner substitution.

---

#### [MED] `MemoryRepository.vectorSearch` has no application-layer owner filter — relies entirely on RLS

**File:** `packages/memory/src/repository.ts:72-104`
**Invariant violated / concern:** Defense-in-depth. The `vectorSearch` SQL query filters only on `embedding IS NOT NULL AND source_kind = ${sourceKind}`. It has no `AND owner_user_id = ${ownerUserId}::uuid` clause. Owner scoping is provided solely by the RLS policy `memory_chunks_select`. This is technically correct today (FORCE RLS + `TO jarvis_app_runtime`), but is a single-layer defense unlike every other read method in the same class (all of which include an explicit `WHERE owner_user_id` clause).
**Detail:** All other `MemoryRepository` methods (`deleteFileChunks`, `deleteAllForUser`, `getFileIndex`, `upsertFileIndex`, `deleteFileIndex`, `listIndexedPaths`) consistently pass `ownerUserId` as a WHERE predicate alongside RLS. `vectorSearch` is the only exception. If the RLS policy were ever accidentally dropped or the role changed, `vectorSearch` would return all users' chunk text.
**Suggested fix:** Add `AND owner_user_id = ${ownerUserId}::uuid` to the vectorSearch WHERE clause and update the signature to accept `ownerUserId: string` (parallel to other methods). The caller (`MemoryRetriever.retrieve`) already runs within a scoped context that has the actor's userId.

---

#### [MED] `ChatMemoryFactsRepository.supersedeFact`, `deleteFact`, and `updateFactImportance` filter only by `id`, with no owner check

**File:** `packages/memory/src/facts-repository.ts:79-103`
**Invariant violated / concern:** Defense-in-depth. These three mutation methods issue `UPDATE`/`DELETE … WHERE id = ${id}::uuid` with no `AND owner_user_id` guard. Ownership enforcement depends solely on the `chat_memory_facts_update` / `chat_memory_facts_delete` RLS policies. The policies are correct (`USING (owner_user_id = app.current_actor_user_id())`), but the application layer offers no redundant check.
**Detail:** `insertFact` and `listActiveFacts` both include explicit `owner_user_id` filters. The three mutation methods are inconsistent with the rest of the class. Under the current RLS configuration a cross-user mutation would be silently rejected (0 rows affected), but the caller has no way to distinguish "fact not found" from "RLS blocked" — which could mask bugs. A future code path receiving a fact `id` from an untrusted source would be protected only by RLS.
**Suggested fix:** Add `AND owner_user_id = ${ownerUserId}::uuid` to each of the three methods. Thread `ownerUserId: string` into their signatures. The caller already has the actor's userId from the AccessContext.

---

#### [MED] `chat_memory_facts` RLS policies carry no `TO <role>` clause — they apply to ALL roles

**File:** `packages/memory/sql/0041_memory_facts.sql:29-42`
**Invariant violated / concern:** Defense-in-depth / policy hygiene. The four `chat_memory_facts` policies (`chat_memory_facts_select/insert/update/delete`) are created without a `TO` clause, so they apply to every role including `PUBLIC` and the superuser (when BYPASSRLS is not set). This differs from the explicit `TO jarvis_app_runtime` scoping used in `0030_memory_index.sql` and the tasks/structured-state migrations.
**Detail:** In practice this does not produce a current exploit (FORCE RLS is enabled and `current_actor_user_id()` returns NULL for unauthenticated connections, blocking access), but it means any future role added to the database automatically inherits these permissive policies without an explicit grant decision. The pattern is inconsistent with the rest of the codebase and could confuse future migrations that assume role-scoped policies.
**Suggested fix:** Add `TO jarvis_app_runtime, jarvis_worker_runtime` to each `chat_memory_facts` policy to match the explicit pattern used elsewhere.

---

#### [LOW] No `assertDataContextDb` guard in `MemoryRepository`, `ChatMemoryFactsRepository`, or any `structured-state` repository

**File:** `packages/memory/src/repository.ts:23`, `packages/memory/src/facts-repository.ts:28`, `packages/structured-state/src/commitments-repository.ts:25`, `packages/structured-state/src/entities-repository.ts:24`, `packages/structured-state/src/preferences-repository.ts:3`
**Invariant violated / concern:** DataContextDb invariant / fail-fast discipline. The tasks module uses `assertDataContextDb(scopedDb)` at the entry point of every public method, providing a clear error message ("Repository access requires withDataContext") when a repository is called outside of `withDataContext`. None of the memory or structured-state repositories call `assertDataContextDb`. An accidental bare-Kysely call will not fail loudly.
**Detail:** The `tasks.test.ts` integration suite explicitly tests this fail-fast behavior. No equivalent test exists for the other modules. This creates a regression risk: a caller bypassing `withDataContext` would silently issue queries without the actor session variable set, causing RLS to reject all rows with no clear error.
**Suggested fix:** Add `assertDataContextDb(scopedDb)` to each public method in `MemoryRepository`, `ChatMemoryFactsRepository`, `CommitmentsRepository`, `EntitiesRepository`, and `PreferencesRepository`. Add a corresponding "fails loudly without withDataContext" test to `memory.test.ts` and `structured-state.test.ts`.

---

#### [LOW] `task_tag_assignments` DELETE is missing a policy — only INSERT/UPDATE/SELECT covered by `task_tag_assignments_rw`

**File:** `packages/tasks/sql/0039_tasks_foundation.sql:154-157`
**Invariant violated / concern:** Missing DELETE policy on a FORCE RLS table. The `task_tag_assignments_rw` policy uses `FOR ALL`, which covers SELECT/INSERT/UPDATE/DELETE. On inspection this is correct — `FOR ALL` does cover DELETE. However the `GRANT` block at line 164 includes `DELETE` only for `jarvis_app_runtime` and not for `jarvis_worker_runtime`. This is intentional (worker does not manage tag assignments), but there is no test verifying that a worker cannot delete tag assignments.
**Detail:** Low risk in isolation — workers currently have no code path to delete tag assignments. This is more a documentation/coverage gap.
**Suggested fix:** Add a comment in the migration explaining the deliberate omission, or add an integration test asserting the worker cannot delete tag assignments.

---

#### [INFO] `memory.test.ts` has no cross-user RLS test for `ChatMemoryFactsRepository`

**File:** `tests/integration/memory.test.ts`
**Invariant violated / concern:** Coverage gap. The integration tests thoroughly cover `MemoryRepository` and `MemoryIngestPipeline` cross-user isolation, but `ChatMemoryFactsRepository` has no tests at all in the integration suite (the file ends at MemoryRetriever). There is no test asserting that User A cannot read, modify, or delete User B's facts.
**Suggested fix:** Add integration tests for `ChatMemoryFactsRepository`: owner can CRUD their own facts, other user's listActiveFacts returns empty, supersedeFact/deleteFact by non-owner is silently rejected.

---

#### [INFO] `structured-state` repositories have no `assertDataContextDb` test coverage in the integration suite

**File:** `tests/integration/structured-state.test.ts`
**Invariant violated / concern:** Coverage gap (mirrors the LOW finding above). The structured-state test suite covers CRUD, cross-user isolation, and VaultWriteBackService thoroughly, but does not include a "fails loudly without withDataContext" test.
**Suggested fix:** Add a test that calls `repo.listVisible({} as never)` and expects a "Repository access requires withDataContext" rejection — after the fix in the LOW finding is applied.

---

#### [INFO] `MemoryRetriever` does not pass `ownerUserId` to `vectorSearch` — ownership is RLS-only

**File:** `packages/memory/src/retrieval.ts:12-20`
**Invariant violated / concern:** Observation related to the MED finding above. `MemoryRetriever.retrieve` does not accept an `ownerUserId` parameter and cannot thread it to `vectorSearch` once the method signature is corrected. The retriever is the primary consumer of `vectorSearch`.
**Detail:** The fix to `vectorSearch` (add owner filter) will require propagating `ownerUserId` through `MemoryRetriever.retrieve` as well. The caller (`chat/src/recall-port.ts`) has `actorUserId` from the AccessContext and can supply it.
**Suggested fix:** Update `MemoryRetriever.retrieve` to accept `ownerUserId: string` and forward it to `repository.vectorSearch`.

---

### Key questions answered

1. **DataContextDb-only + actorUserId from AccessContext:**
   - **Tasks:** Fully compliant. Every public method calls `assertDataContextDb`. `owner_user_id` on INSERT uses `sql\`app.current_actor_user_id()\`` — never from the request body. VERIFIED OK.
   - **Memory:** `MemoryRepository` and `ChatMemoryFactsRepository` accept `DataContextDb` correctly but do NOT call `assertDataContextDb`. The `ownerUserId` on INSERT is passed as a caller-supplied parameter from `ingest.ts` (sourced from `vaultCtx.actorUserId` which derives from AccessContext) and `chat/src/jobs.ts` (sourced from `job.data.actorUserId`). The chain is trustworthy but not enforced in the repository itself. SEE LOW FINDING.
   - **Structured-state:** Accepts `DataContextDb` but no `assertDataContextDb`. `ownerUserId` accepted as an input field rather than derived from DB session. SEE HIGH FINDING.
   - **Vault:** No DB access. `VaultContext` is required and checked via `assertVaultContext` (available but not always called by vault-ops consumers). The VaultContextRunner derives `vaultRoot` from `accessContext.actorUserId` making path-level isolation automatic. VERIFIED OK.

2. **Memory embedding path — correct owner on INSERT?** Yes. `ingest.ts` reads `ownerUserId = vaultCtx.actorUserId` which is set by `VaultContextRunner.withVaultContext` from `accessContext.actorUserId`. The owner is never sourced from the payload or file content. The RLS INSERT policy also enforces `owner_user_id = app.current_actor_user_id()` as a second layer. VERIFIED OK for the write path.

3. **Structured-state — DB-layer RLS vs route-layer only?** DB-layer RLS is present and FORCED for all three tables (`commitments`, `entities`, `preferences`). The policies correctly enforce `owner_user_id = app.current_actor_user_id()` on SELECT/INSERT/UPDATE/DELETE. VERIFIED OK at the SQL layer, with the HIGH finding above about the application-layer ownerUserId input being the supplementary concern.

4. **pg-boss payloads metadata-only?** For tasks: YES. `DeferredTaskStatusPayload` = `{actorUserId, taskId, requestedStatus, idempotencyKey}` — no titles, descriptions, or content. Validated by `isDeferredTaskStatusPayloadMetadataOnly` before enqueue AND inside the worker, and confirmed by integration test. For chat embed jobs: `EmbedTurnJobPayload = {actorUserId, threadId, messageId}` — metadata only. VERIFIED OK.

5. **Vault read path — no direct `fs.readFile`?** Correct. All vault I/O in `memory` and `structured-state` goes through `@jarv1s/vault` functions (`readVaultFile`, `writeVaultFile`, etc.). No raw `fs.readFile`/`readFileSync` calls were found in these packages. Vault-ops itself uses `node:fs/promises` internally but is gated by `resolveVaultPath` which enforces traversal protection. VERIFIED OK.

6. **SQL migrations — ENABLE RLS + FORCE RLS?** All tables across all four modules have both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. The HIGH finding about missing worker policies on `memory_chunks`/`memory_file_index` is a policy-gap issue, not a missing FORCE RLS issue.

---

### Overall health

The tasks module is the most robust in this phase — it consistently uses `assertDataContextDb`, sets `owner_user_id` via DB session rather than caller input, has metadata-only job payloads, and is well-covered by integration tests including negative cross-user cases. The memory and structured-state modules follow the correct architectural pattern (DataContextDb, VaultContext, FORCE RLS) but carry two HIGH findings: a missing worker RLS policy that will silently break the chat-memory embed path in production, and structured-state repositories accepting caller-supplied `ownerUserId` on INSERT. These should be addressed before the next phase ships any chat-to-memory write path.
