## Phase 12 — Module memory

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 2
- MED: 5
- LOW: 4
- INFO: 2

### Findings

#### [HIGH] Repositories never call `assertDataContextDb` — branded-handle invariant unenforced
**File:** `packages/memory/src/repository.ts:24` (and every method 24–195); `packages/memory/src/facts-repository.ts:29` (and methods 29–103)  
**Invariant violated / concern:** Hard invariant #3 ("DataContextDb only") / canonical data-context pattern. Both `MemoryRepository` and `ChatMemoryFactsRepository` accept a `DataContextDb` parameter but never invoke the `assertDataContextDb(scopedDb)` runtime guard at the top of any public method. Every other repository in the codebase enforces it on every public method (`packages/db/src/sharing/shares-repository.ts:25`, `packages/chat/src/repository.ts:26`, `packages/ai/src/repository.ts:102`, etc.).  
**Detail:** The branding is purely a TypeScript type today; nothing prevents a caller from passing `{ db: rootTx } as unknown as DataContextDb` or a raw object at the JS boundary. Memory holds the most sensitive derived corpus (full vault text + chat transcripts + LLM-extracted profile facts), so a bypass here means RLS-unscoped reads/writes against `memory_chunks`/`chat_memory_facts`. The guard is the single defensive runtime check that the actor-scoping transaction was actually established; its consistent absence across this module is a real divergence from the enforced pattern, not a style nit.  
**Suggested fix:** Add `assertDataContextDb(scopedDb);` as the first statement of every public method in both repositories, matching `chat`/`ai`/`db` repos. Cheap, mechanical, and closes the only runtime line of defense if the type brand is ever circumvented.

#### [HIGH] `vectorSearch` returns rows with no explicit owner predicate — relies entirely on RLS, and SELECT-orders before the limit across all users' vectors
**File:** `packages/memory/src/repository.ts:72-104`  
**Invariant violated / concern:** Invariant #2 (private by default) / defense-in-depth. `vectorSearch` filters only on `embedding IS NOT NULL AND source_kind = ...`; there is no `owner_user_id = app.current_actor_user_id()` predicate in the query. Correctness depends 100% on the `memory_chunks_select` RLS policy being active for the connected role.  
**Detail:** This is the one read path that can surface another user's private content (it is the recall path used by `packages/chat/src/recall-port.ts:76` to build AI prompts). If RLS ever fails to apply — a misconfigured role, a future migration that touches the policy, or a caller that obtains a handle outside `withDataContext` (see the prior finding) — this query silently returns and ranks chunks from every user in the table, and those chunks are fed straight into an AI prompt (potential cross-user data exfiltration via recall). Every other owner-scoped query in this module carries an explicit `owner_user_id = ...` predicate (e.g. `deleteFileChunks`, `getFileIndex`, `listIndexedPaths`); `vectorSearch` is the lone exception, and it is the highest-impact one. Adding the predicate is also a meaningful performance win: the HNSW scan + ORDER BY currently ranks across all users' vectors before `LIMIT`, then RLS prunes — the cost scales with total corpus, not the caller's.  
**Suggested fix:** Add `AND owner_user_id = app.current_actor_user_id()` to the `WHERE` clause (belt-and-suspenders alongside RLS), matching the rest of the module. This both hardens against an RLS gap and lets the planner constrain the vector scan to the owner.

#### [MED] `deleteAllForUser` leaves `memory_file_index` rows orphaned — non-atomic, half-applied "delete everything"
**File:** `packages/memory/src/repository.ts:63-70`  
**Invariant violated / concern:** Quality bar: "non-atomic multi-step updates that can leave half-applied state." `deleteAllForUser` deletes from `memory_chunks` and `memory_links` but NOT from `memory_file_index` (one of the module's four owned tables, `manifest.ts:32`).  
**Detail:** The method name and its only caller (`rebuildFromVault`, `ingest.ts:124-132`) imply a full wipe. The stale `memory_file_index` rows are masked today only because `rebuildFromVault` immediately re-ingests with `force: true`, which `upsertFileIndex`-es each present file back. But (a) any vault file deleted between the two operations leaves a permanently orphaned index row that `purgeDeletedFiles` will never see (it only iterates `listIndexedPaths` against present files — and the row IS in `listIndexedPaths`, so actually it would be purged on a later full run, but the chunks are already gone so `deleteFile` is a no-op leaving the index row's `chunk_count` lying); and (b) if anyone calls `deleteAllForUser` directly as a "reset," the file-index checkpoint table is left fully populated, so a subsequent non-forced ingest will `skip` every file (hash matches) and never re-create the chunks — silent data loss. The method is exported (`index.ts:20`) so external callers can hit this.  
**Suggested fix:** Add `DELETE FROM app.memory_file_index WHERE owner_user_id = ${ownerUserId}::uuid` to `deleteAllForUser` so it truly clears all owned, per-user derived tables.

#### [MED] LLM-extracted user facts (`chat_memory_facts`) are excluded from `export:user` data portability
**File:** `scripts/export-user-data.ts:105-475` (table list ends at `briefing_runs`; no `chat_memory_facts`); table defined `packages/memory/sql/0041_memory_facts.sql:4`  
**Invariant violated / concern:** Data-subject portability / completeness. `chat_memory_facts` stores `preference | fact | profile | goal` content about the user — user-specific knowledge that is NOT regenerable from the vault. It is absent from the user-data export.  
**Detail:** `memory_chunks`/`memory_links`/`memory_file_index` are legitimately omitted (derived, rebuildable from the vault, documented as such in `0030_memory_index.sql:1`). But facts are durable, LLM-distilled assertions about the person that would be lost on export and cannot be reconstructed. For a project whose stated posture is holding "lots of personal data," an export that silently drops the assistant's profile of the user is a real gap.  
**Suggested fix:** Add a `chat_memory_facts` SELECT (active rows for the owner) to `readExportTables`. Confirm the same path's `delete:user` is covered (the `ON DELETE CASCADE` FK on `owner_user_id` handles deletion, so delete is fine; only export is missing).

#### [MED] `insertFact` returns `result.rows[0]!` with a non-null assertion masking an empty-result invariant
**File:** `packages/memory/src/facts-repository.ts:55`  
**Invariant violated / concern:** Quality bar: "unjustified non-null assertions … muddying the real contract." `return this.#mapRow(result.rows[0]!)` after an `INSERT ... RETURNING *`.  
**Detail:** A successful `INSERT ... RETURNING` always yields exactly one row, so the assertion is "safe" — but it is the kind of silent `!` that, if the statement ever becomes a conditional upsert (`ON CONFLICT DO NOTHING`), turns into an undefined-deref `TypeError` far from the cause. The contract that "this insert always returns a row" is load-bearing and should be explicit, not buried in a `!`.  
**Suggested fix:** Replace with an explicit guard: `const row = result.rows[0]; if (!row) throw new Error("insertFact returned no row"); return this.#mapRow(row);` — or hoist a small `#requireRow` helper.

#### [MED] `getEmbeddingProviderConfig` casts an arbitrary env string to `EmbeddingProviderKind` with no validation
**File:** `packages/memory/src/embedding-provider-config.ts:28`  
**Invariant violated / concern:** Quality bar: unsafe cast obscuring the real contract; missing boundary validation (dimension E). `const kind = (process.env["JARVIS_EMBED_PROVIDER"] ?? "local") as EmbeddingProviderKind;`  
**Detail:** Any value (`JARVIS_EMBED_PROVIDER=loca1`) is asserted to be `"local" | "stub"`. `createEmbeddingProvider` then `switch`es on it with no `default`, so a typo silently falls through and returns `undefined` (the function's return type claims `EmbeddingProvider`, so this is a structural-unsoundness hole). The failure surfaces later as a cryptic "cannot read property of undefined" at first embed call, not at config time.  
**Suggested fix:** Validate the env value against the known set at the boundary and throw a clear error on an unknown kind (or fall back to `"local"` with a warning). Add a `default:` arm to the `switch` that throws `never`-style on an unexpected kind.

#### [LOW] Vector literals built by string interpolation rather than a parameterized cast
**File:** `packages/memory/src/repository.ts:36`, `:78`, `:88`, `:92`  
**Invariant violated / concern:** Defense-in-depth against injection (dimension A). `const vectorLiteral = \`[${chunk.embedding.join(",")}]\`` then interpolated as `${vectorLiteral}::vector`.  
**Detail:** The values are `number[]` produced internally by the embedding provider, so this is not exploitable today (numbers can't carry SQL). But it is a string-built SQL fragment passed into `sql\`\`` as a value parameter, and if the array element type ever loosened (e.g. a future provider returning `string` tokens) it becomes an injection vector. The same literal is also interpolated twice in `vectorSearch` (the `<=>` operand appears in both SELECT and ORDER BY).  
**Suggested fix:** Keep numeric provenance enforced (it already is via the `number[]` type), and add a runtime `Number.isFinite` filter or build the literal once and bind it as a single parameter to avoid duplication and make the numeric contract explicit.

#### [LOW] `chat_memory_facts` RLS policies omit explicit `TO jarvis_app_runtime` / `jarvis_worker_runtime`
**File:** `packages/memory/sql/0041_memory_facts.sql:28-42`  
**Invariant violated / concern:** Consistency of the least-privilege RLS pattern. The chunk/link/file-index policies all scope to `TO jarvis_app_runtime` (`0030_memory_index.sql:46`, `0032_memory_embedding_768.sql:44`); the facts policies are written `FOR SELECT USING (...)` with no role, so they apply to `PUBLIC`.  
**Detail:** Functionally the table still has `ENABLE`/`FORCE RLS` and the `USING (owner_user_id = current_actor_user_id())` predicate, and grants are limited to the two runtime roles, so this is not an exploitable hole. But the inconsistency means the policy also governs any future role granted access, and it diverges from the module's own established convention — exactly the kind of drift that hides a real gap during a later audit.  
**Suggested fix:** Add `TO jarvis_app_runtime, jarvis_worker_runtime` to the four `chat_memory_facts` policies to match the rest of the module.

#### [LOW] No retention/expiry on `chat_memory_facts` or `memory_chunks` — unbounded per-user growth
**File:** `packages/memory/sql/0041_memory_facts.sql:4-17`; `packages/memory/src/facts-repository.ts:79-85`  
**Invariant violated / concern:** Module-focus item: retention/expiry vs unbounded growth.  
**Detail:** `supersedeFact` only flips `status = 'superseded'` and never deletes; `listActiveFacts` filters them out, so superseded rows accumulate forever with no pruning job. Chat-sourced `memory_chunks` (every turn-pair embedded, per `packages/chat/src/jobs.ts:38`) likewise grow without bound or compaction. There is no TTL, no cap, no archival sweep anywhere in the module. For a long-lived single-tenant assistant this is slow-motion table bloat plus an HNSW index that degrades as it grows.  
**Suggested fix:** Decide a retention policy (e.g. hard-delete facts superseded > N days, or cap chat chunks per thread) and add a pg-boss maintenance job or a documented operator script. At minimum, document the intentional unboundedness as an accepted limitation.

#### [LOW] `MemoryRepository`/`ChatMemoryFactsRepository` are stateless classes — methods could be free functions
**File:** `packages/memory/src/repository.ts:23`; `packages/memory/src/facts-repository.ts:28`  
**Invariant violated / concern:** Quality bar: thin abstraction / incidental complexity (code-judo). Neither class has constructor state or fields; every method takes `scopedDb` explicitly.  
**Detail:** The class wrapper adds `new MemoryRepository()` instantiation ceremony and an `this`-binding surface for zero benefit — they are namespaces over pure functions. This matters less than the findings above and the project clearly standardizes on repository classes, so this is a deliberate-convention call rather than a defect; flagging it as the one available structural simplification. If repository classes are the house pattern, leave as-is.  
**Suggested fix:** Optional — if the team is open to it, collapse to a module of exported functions (or `export const memoryRepository = { ... }`). Otherwise mark WONTFIX as an intentional convention.

#### [INFO] RLS is owner-only and correctly modeled; cross-user isolation is tested
**File:** `packages/memory/sql/0030_memory_index.sql:38-82`; `tests/integration/memory.test.ts:206-224`, `:613-617`  
**Invariant violated / concern:** None — review note. All four owned tables (`memory_chunks`, `memory_links`, `memory_file_index`, `chat_memory_facts`) have `ENABLE` + `FORCE ROW LEVEL SECURITY` and owner-only `current_actor_user_id()` predicates for every operation. No `BYPASSRLS`, no admin carve-out, no share/recipient path (correct: memory is strictly private, never shared). Worker grants were added deliberately in `0040` with a documented rationale (recall embed jobs), and only after `0030` correctly withheld them. Cross-user `vectorSearch` isolation is asserted in the integration suite. This matches the documented RLS shareability map (memory = owner-only). Well done — the security model here is sound; the HIGH findings above are defense-in-depth hardening, not active holes.

#### [INFO] No secrets, prompts, or content placed in job payloads from this module
**File:** `packages/memory/src/*` (no pg-boss `send`/payload construction in the module)  
**Invariant violated / concern:** None — review note (dimensions E/F). The memory module contains no pg-boss job enqueue or payload construction; it exposes repositories/services consumed by the chat module's worker jobs. The module stores user content (vault text, chat turns, facts) in its own tables under RLS — appropriate, that is the module's purpose — and never logs that content, never returns secrets, and holds no credentials. `pgvector/pgvector:pg17` is unaffected here; the HNSW index in `0032` is consistent with that image. The four migrations live correctly in `packages/memory/sql/` (invariant #11) and are registered in `manifest.ts:22-27`; `ownedTables` matches the tables created. Module isolation (invariant #9) is respected — memory imports only `@jarv1s/db`, `@jarv1s/vault`, `@jarv1s/module-sdk`, and queries only its own `app.memory_*`/`app.chat_memory_facts` tables.
