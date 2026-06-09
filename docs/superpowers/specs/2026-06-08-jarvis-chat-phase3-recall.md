# Jarv1s Chat — Phase 3: Recall

**Status:** Draft — awaiting approval
**Date:** 2026-06-08
**Epic:** #22 (Jarv1s Chat — live, agentic, remembering) · Phase 3
**Supersedes/expands:** §8 of `docs/superpowers/specs/2026-06-08-jarvis-chat-design.md`
**Depends on:** Phase 1 (PR #21 + #23 + #25, merged), Phase 2 core (PR #33, merged)

---

## 1. Goal

Jarvis remembers. When a new chat session starts, Jarvis is injected with relevant episodic
memories from past conversations and a small always-loaded fact/profile set extracted from
those conversations. The user can turn recall on/off, start incognito (temporary) chats that
are never embedded or recalled, and manage their stored memories.

This phase reuses `packages/memory` (embeddings, vector store, ingestion idempotency pattern)
and extends it with a `'chat'` source kind. It adds no new external infrastructure.

---

## 2. Non-goals (this phase)

- Cross-user memory sharing or any non-owner access to memories.
- Embedding content other than user+assistant turn-pairs (system messages, tool calls).
- Summarizing long conversation histories for context-window management (deferred; flagged in
  the parent spec §10 Q3).
- Per-topic retrieval in the middle of a conversation (only at session launch).
- Streaming facts extraction or real-time reconcile during a turn.
- Any change to `packages/tasks/`, `packages/calendar/`, `packages/connectors/`, or any module
  besides `packages/memory` (extensions), `packages/chat` (session injection + controls), the
  web shell, and integration/unit tests.

---

## 3. Hard invariants honored

- **DataContextDb only / no BYPASSRLS.** All repository calls take a branded `DataContextDb`
  handle; no root Kysely.
- **Private by default.** `chat_memory_facts` and `chat_user_memory_settings` are owner-only
  (RLS `owner_user_id = current_actor_user_id()`). `memory_chunks` with `source_kind='chat'` is
  already owner-only by the existing policy.
- **Metadata-only job payloads.** Embed and extract-facts jobs carry only
  `{actorUserId, threadId, messageId}` — no message body, no prompt text.
- **Secrets never embedded.** Only `chat_messages.body` text is embedded; provider credentials,
  tokens, and metadata are never injected into prompts or stored in memory_chunks.
- **Module isolation.** `packages/chat` uses `packages/memory` only via its public export
  (`packages/memory/src/index.ts`). No direct table queries across module boundaries.
- **Never edit applied migrations.** All SQL is in new numbered files; no edits to existing
  migration files.
- **Provider-agnostic AI.** Fact extraction uses the capability router — no provider hardcoded.

---

## 4. Architecture overview

```
Turn completes (recordTurn)
  │
  ├─ if !incognito && recall.enabled:
  │    enqueue pg-boss job  chat.embed-turn  {actorUserId, threadId, messageId}
  │    enqueue pg-boss job  chat.extract-facts {actorUserId, threadId}
  │
  ▼
Worker picks up job
  chat.embed-turn   → embed turn-pair text → memory_chunks (source_kind='chat', source_path=threadId)
  chat.extract-facts → LLM extract → reconcile with chat_memory_facts (ADD/UPDATE/DELETE/NOOP)

Session launch (launchSession)
  │
  ├─ if !incognito && recall.enabled:
  │    retrieve top-K episodic chunks via MemoryRetriever (sourceKind='chat')  [hybrid: sim + recency]
  │    load active facts from ChatMemoryFactsRepository
  │    inject <memory> seed block (chunks: 5–8, ~1000 tokens; facts: all active)
  │
  └─ inject <conversation> replay block (existing)
  └─ launch engine
```

The seed message format:

```
<memory>
Recalled from past conversations:
[2026-05-28, thread abc] You were working on fixing the auth middleware bug.
[2026-06-01, thread def] You mentioned preferring TypeScript for new modules.

What I know about you:
- You work on a project called Jarv1s (a personal assistant platform).
- You prefer concise answers and direct suggestions.
</memory>

<conversation>
… prior turns of current conversation (existing replay block) …
</conversation>
```

The `<memory>` block is injected BEFORE the `<conversation>` replay block so the model has
full historical context before seeing the active conversation.

---

## 5. Data model

### 5.1 Existing tables extended

**`app.memory_chunks`** (owned by `packages/memory`):

- `source_kind` CHECK widened from `('vault', 'connector')` → `('vault', 'connector', 'chat')`.
- Chat turns use `source_path = threadId::text` (UUID string).
- `memory_file_index.source_kind` CHECK widened the same way.
- Worker grants added (see §6 Migrations).

**`app.chat_threads`** (owned by `packages/chat`):

- Add column `incognito BOOLEAN NOT NULL DEFAULT FALSE` — set on thread creation for temporary
  chats; immutable once set. Affects both ingestion (skip embed/extract) and retrieval (skip
  inject).

### 5.2 New tables

**`app.chat_memory_facts`** (owned by `packages/memory`):

```sql
CREATE TABLE IF NOT EXISTS app.chat_memory_facts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  category        TEXT        NOT NULL CHECK (category IN ('preference','fact','profile','goal')),
  content         TEXT        NOT NULL,
  source_thread_id UUID       REFERENCES app.chat_threads(id) ON DELETE SET NULL,
  importance      NUMERIC(3,2) NOT NULL DEFAULT 0.50
                             CHECK (importance BETWEEN 0.0 AND 1.0),
  status          TEXT        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','superseded')),
  superseded_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

RLS: owner-only (INSERT/SELECT/UPDATE/DELETE all scoped to `owner_user_id`).
Grants: `jarvis_app_runtime` + `jarvis_worker_runtime` (worker runs reconcile).

**`app.chat_user_memory_settings`** (owned by `packages/chat`):

```sql
CREATE TABLE IF NOT EXISTS app.chat_user_memory_settings (
  user_id         UUID        PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  recall_enabled  BOOLEAN     NOT NULL DEFAULT TRUE,
  facts_enabled   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

RLS: owner-only (`user_id = current_actor_user_id()`).
Grants: `jarvis_app_runtime` only (no worker access needed; defaults are read at session launch
via API).

---

## 6. Migrations

Migration files are numbered from 0040 (0039 = tasks foundation). Module SQL lives in the
owning module's `sql/` directory; never in `infra/postgres/migrations/`.

| #    | File                                              | Package | What                                                                                                                  |
| ---- | ------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| 0040 | `packages/memory/sql/0040_memory_chat_source.sql` | memory  | Widen `source_kind` CHECK on `memory_chunks` + `memory_file_index`; add `jarvis_worker_runtime` grants on both tables |
| 0041 | `packages/memory/sql/0041_memory_facts.sql`       | memory  | Create `chat_memory_facts`, RLS, grants (app + worker)                                                                |
| 0042 | `packages/chat/sql/0042_chat_memory_settings.sql` | chat    | Create `chat_user_memory_settings`, RLS, grants; add `incognito` column to `chat_threads`                             |

Both manifests (`memoryModuleManifest`, `chatModuleManifest`) must list their new migration
files in the correct order.

### Known trap: ALTER DOMAIN / ALTER CHECK

PostgreSQL does not support `ALTER TABLE … ALTER CHECK …` — you must `DROP CONSTRAINT` and
`ADD CONSTRAINT`. Both `memory_chunks` and `memory_file_index` define the CHECK inline on the
column in migration 0032. The 0040 migration must use:

```sql
ALTER TABLE app.memory_chunks DROP CONSTRAINT IF EXISTS memory_chunks_source_kind_check;
ALTER TABLE app.memory_chunks ADD CONSTRAINT memory_chunks_source_kind_check
  CHECK (source_kind IN ('vault', 'connector', 'chat'));
-- repeat for memory_file_index
```

---

## 7. Repository changes (`packages/memory/src/repository.ts`)

### 7.1 `upsertFileChunks` — add `sourceKind` param

Currently hardcodes `${"vault"}` (line 41). Change signature to accept `sourceKind: string`
and pass it through. The only caller today is `packages/memory/src/ingest.ts`
(`IngestionService`/`VaultIngester`) — update it to pass `'vault'` explicitly.

### 7.2 `vectorSearch` — add `sourceKind` filter

Currently returns chunks across all source kinds (no WHERE on source_kind). Add a required
`sourceKind: string` parameter and filter:

```sql
WHERE embedding IS NOT NULL AND source_kind = ${sourceKind}
```

Update `MemoryRetriever.retrieve()` to accept and forward `sourceKind`. Existing callers pass
`'vault'`.

### 7.3 `deleteFileChunks` — add `sourceKind` filter (defensive)

Currently deletes by `(owner_user_id, source_path)` only. Add `source_kind` filter to prevent
accidental cross-kind deletion if source paths ever collide.

### 7.4 New: `ChatMemoryFactsRepository`

New class in `packages/memory/src/facts-repository.ts`, exported from `index.ts`:

```typescript
listActiveFacts(db, ownerUserId): Promise<MemoryFact[]>
upsertFact(db, ownerUserId, data): Promise<MemoryFact>
supersedeFact(db, ownerUserId, factId): Promise<void>
deleteFact(db, ownerUserId, factId): Promise<void>
```

---

## 8. Ingestion pipeline

### 8.1 What gets embedded (episodic)

Each completed user+assistant turn-pair. Text format for embedding:

```
User: <user message body>
Assistant: <assistant reply body>
```

Embedded with the document prefix (nomic: `"search_document: "`). `source_path = threadId`,
`source_kind = 'chat'`. One chunk per turn-pair (no line-start/end splitting needed; turns
are naturally bounded). `content_hash = SHA-256(text)` for idempotency.

### 8.2 Job: `chat.embed-turn`

Payload: `{ actorUserId: string, threadId: string, messageId: string }`
Handler runs under `jarvis_worker_runtime` (needs the grants added in migration 0040).

Steps:

1. Load the turn-pair: fetch user turn + assistant reply for `messageId` from `chat_messages`.
2. Build embedded text (format above).
3. Compute `content_hash`; check `memory_file_index` for existing entry with same hash → skip
   if unchanged (idempotency).
4. Embed via `LocalEmbeddingProvider`.
5. Call `MemoryRepository.upsertFileChunks(db, actorUserId, threadId, chunks, 'chat', ...)`.
6. Upsert `memory_file_index` record.

### 8.3 Job: `chat.extract-facts`

Payload: `{ actorUserId: string, threadId: string }`
Handler runs under `jarvis_worker_runtime`.

Steps:

1. Load the last N turns of the thread (last 5 turn-pairs is sufficient).
2. Call the capability router to run a short `extract-facts` prompt:
   - Input: recent turns + list of existing active facts.
   - Output: structured list of operations: `{op: 'ADD'|'UPDATE'|'DELETE'|'NOOP', factId?, category, content, importance}`.
3. Apply operations to `chat_memory_facts` (upsert / supersede).

The LLM call uses a small, cheap model if available (tool: `capability_router`, capability:
`'chat-extract'`); falls back to the user's active chat model. Model selection is the router's
responsibility — not hardcoded.

### 8.4 Enqueueing

After `ChatPersistencePort.recordTurn()` completes, the chat route enqueues both jobs if:

- `chat_threads.incognito = FALSE` for the current thread
- `chat_user_memory_settings.recall_enabled = TRUE` (default: TRUE — absent row → TRUE)

Enqueue logic lives in `packages/chat` (the route/persistence layer), not in the manager.

---

## 9. Retrieval + seed injection

### 9.1 `MemoryRetriever` — hybrid scoring

The current `MemoryRetriever.retrieve()` returns pure cosine-ranked chunks. For chat recall,
use a hybrid score that incorporates recency:

```
score = w_sim * cosine_similarity + w_rec * recency_decay
w_sim ≈ 0.6, w_rec ≈ 0.25  (remaining ~0.15 is reserved for future importance weight)
recency_decay = exp(-λ * days_since_turn)  with λ ≈ 0.05 (half-life ~14 days)
```

This hybrid scoring is a new `hybridRetrieve(db, query, limit, sourceKind)` method on
`MemoryRetriever` (or a separate `ChatMemoryRetriever` class in packages/memory). The
`vectorSearch` SQL returns `similarity` + `source_path` (= threadId); the handler fetches the
thread's `last_active_at` timestamp to compute recency. Top-K = 20 candidates → re-rank → 5–8
injected (highest-scoring) up to ~1000-token budget (count tokens by character proxy: 4
chars ≈ 1 token).

### 9.2 Injection in `ChatSessionManager`

`ChatSessionManager` gains a new optional injected dependency:

```typescript
interface RecallPort {
  recall(
    actorUserId: string,
    currentQuery?: string
  ): Promise<{
    episodicChunks: Array<{ text: string; date: string; threadId: string }>;
    facts: Array<{ category: string; content: string }>;
  }>;
}
```

`launchSession` calls `this.deps.recall?.recall(actorUserId)` before submitting the replay
block. If recall is off or the thread is incognito, `RecallPort` returns empty arrays (the
caller checks settings). The `<memory>` block is only prepended when at least one chunk or
fact is present. Omitting `recall` in deps is valid (Phase 1 behavior is preserved).

`RecallPort.recall` implementation (in `packages/chat`) reads settings from
`ChatUserMemorySettingsRepository`, returns empty immediately if recall is disabled, otherwise
calls into `packages/memory` via the public API.

### 9.3 Cache / skip optimization

Skip the vector search call if the current session's last-queried embedding has cosine
distance < 0.05 to the current query (effectively the same question). Cache the last
(embedding, result) pair per user session. Deferred to a follow-up if it proves unnecessary
in practice.

---

## 10. Controls

### 10.1 Recall on/off (`chat_user_memory_settings.recall_enabled`)

- **REST:** `GET /api/chat/memory/settings` (returns `{ recall_enabled, facts_enabled }`),
  `PATCH /api/chat/memory/settings` (updates either field). Both are owner-only via the
  existing auth middleware.
- **Web:** a toggle in the chat drawer settings panel (or the global settings page —
  implementation choice for the UI slice).
- Disabling recall: new sessions skip the `<memory>` block; jobs are not enqueued. Existing
  stored memories are preserved (the user can re-enable later).

### 10.2 Incognito / temporary chat

- **REST:** `POST /api/chat/clear?incognito=true` starts a new thread with
  `chat_threads.incognito = TRUE` (the existing `/clear` endpoint is extended, or a new
  `POST /api/chat/thread` endpoint adds this flag — implementation choice).
- **Web:** a "Temporary chat" button/option in the drawer's "New chat" flow.
- An incognito thread: never enqueues embed or extract jobs; skips recall injection at session
  launch. Turns are still persisted to `chat_messages` (the conversation is still durable and
  browsable) — just not embedded.

### 10.3 Memory management

- **REST:** `GET /api/chat/memory/facts` (owner's active facts),
  `DELETE /api/chat/memory/facts/:id` (supersede a fact),
  `PATCH /api/chat/memory/facts/:id` (edit content).
- **Web:** a "My memory" panel accessible from the chat drawer. Lists active facts, allows
  editing and deletion. Episodic chunks are not surfaced here (too many); only the extracted
  facts.

---

## 11. RLS classification

| Table                                | Classification | Policy                                                    |
| ------------------------------------ | -------------- | --------------------------------------------------------- |
| `memory_chunks` (source_kind='chat') | owner-only     | same as vault — `owner_user_id = current_actor_user_id()` |
| `chat_memory_facts`                  | owner-only     | `owner_user_id = current_actor_user_id()`                 |
| `chat_user_memory_settings`          | owner-only     | `user_id = current_actor_user_id()`                       |

No sharing of memory across users; no recipient-only or owner-or-share classification needed.

---

## 12. Testing strategy

**Unit (no DB):**

- `MemoryRetriever.hybridRetrieve`: scoring math with fixture chunks.
- `RecallPort` integration with fake settings repository (recall off → empty; incognito → empty).
- `ChatSessionManager.launchSession` with a fake `RecallPort`: seed block format; block absent
  when recall is off.
- Extract-facts job: reconcile logic (ADD/UPDATE/DELETE/NOOP) against fixture facts.

**Integration (real DB, `jarvis_worker_runtime` role):**

- Worker grants regression: `chat.embed-turn` and `chat.extract-facts` handlers complete
  without `42501` errors.
- Episodic embed: turn-pair stored in `memory_chunks` with correct `source_kind='chat'`.
- Retrieval: embedded chunk retrieved for a semantically matching query.
- Incognito: no `memory_chunks` rows created for incognito threads.
- RLS: a second user cannot see user A's `chat_memory_facts` or `memory_chunks` (source_kind='chat').
- `chat_user_memory_settings`: recall disabled → no chunks created, no `<memory>` block injected.

**E2E (Playwright, mocked engine):**

- Drawer: send turn → memory indicator appears → new chat → recalled context visible in seed
  (inspected via mock engine's received input).
- Incognito: "Temporary chat" mode → no memory recall label; no chunks in DB after session.
- Memory management panel: fact visible, deletable.

---

## 13. Known traps (spec-time; document before coding)

1. **Worker grants missing.** `jarvis_worker_runtime` has NO grants on `memory_chunks` or
   `memory_file_index` today (only `jarvis_app_runtime` does). The embed/extract jobs will hit
   `42501`. Migration 0040 must add them — the same trap as chat transport pre-PR #17/#36.

2. **`source_kind` CHECK allows only `'vault'` and `'connector'`.** Must widen to include
   `'chat'` in migration 0040 using `DROP CONSTRAINT` + `ADD CONSTRAINT` (ALTER TABLE
   ALTER CHECK is not valid PostgreSQL).

3. **`upsertFileChunks` hardcodes `'vault'`.** Change signature to accept `sourceKind`; update
   the single existing caller (`VaultIngester`) to pass `'vault'` explicitly.

4. **`vectorSearch` has no `source_kind` filter.** Without one, chat recall would return vault
   chunks mixed with chat chunks. Add the filter and update `MemoryRetriever.retrieve()`.

5. **`deleteFileChunks` has no `source_kind` filter.** Add it defensively; update the caller
   (`IngestionService`) to pass `sourceKind`.

6. **Never edit applied migrations.** Migrations 0030 and 0032 are applied and hash-checked.
   All changes go in new numbered files (0040+).

---

## 14. Exit criteria

Each slice must leave `pnpm verify:foundation` green before the next begins. Final exit:

- [ ] `pnpm verify:foundation` green (lint, format, typecheck, migrations, integration tests).
- [ ] `pnpm audit:release-hardening` green.
- [ ] Worker can write to `memory_chunks` (source_kind='chat') without permission errors.
- [ ] After a chat turn: `memory_chunks` row exists with `source_kind='chat'`.
- [ ] New chat session: `<memory>` block injected into seed when past turns exist.
- [ ] Incognito thread: no `memory_chunks` rows; no `<memory>` block in seed.
- [ ] Recall disabled: no new chunks; no block injected.
- [ ] `chat_memory_facts` CRUD API works under RLS (owner-only).
- [ ] A second test user cannot access user A's memories.
- [ ] Secrets (provider credentials, tokens) are never present in `memory_chunks.text`.
