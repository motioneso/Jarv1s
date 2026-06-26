# Jarvis memory graph substrate (#528)

**Status:** approved
**Date:** 2026-06-26
**Owner:** Ben + Codex
**Issue:** #528
**Related follow-ups:** #529 automatic distillation, #530 passive retrieval, #532 confidence-aware
memory, #533 editable dashboard, #537 commitment extraction, #538 person/contact model, #539
source-backed answers.

## 1. Problem

Jarvis has `app.chat_memory_facts`, but it is still a flat fact list. It can store some preferences
and facts, yet it is not a first-class memory system:

- recall is mostly "load all active facts" rather than query-specific graph recall;
- facts do not model people, projects, decisions, constraints, or relationships as first-class
  nodes;
- source evidence is thin (`source_thread_id` only);
- there is no temporal validity model beyond `superseded_at`;
- future features risk each inventing their own memory shape.

Ben wants memory to be robust from the start, closer to a codebase memory graph than a notes dump:
structured records, relationships, provenance, temporal truth, and easy recall.

## 2. Decision

Build a **Postgres-native Jarvis memory graph** as the durable memory substrate.

Do not import Graphiti, Mem0, LangMem, Letta, Cognee, Neo4j, or another memory runtime in V1. Use
their useful patterns, not their infrastructure:

- Mem0: simple remember/search contract.
- Graphiti/Zep: entities, relationships, episodes, temporal validity, provenance.
- LangMem: background consolidation can update memory later.
- Letta/MemGPT: compact core memory plus searchable archival memory.
- Cognee: ingestion, structuring, and recall are separate stages.

Jarv1s owns the schema, repositories, RLS, export/delete behavior, and recall API. This keeps memory
inside the existing private-by-default security model and avoids operating a second graph stack.

## 3. Memory Model

### 3.1 Entities

`app.memory_entities` stores durable things Jarvis may reason about.

Entity kinds:

- `person`
- `project`
- `preference`
- `goal`
- `constraint`
- `decision`
- `topic`
- `place`
- `organization`
- `self`

Core fields:

- `id`
- `owner_user_id`
- `kind`
- `name`
- `summary`
- `status`: `active | archived | merged`
- `importance`: `0.00..1.00`
- `pinned`: boolean
- `created_at`, `updated_at`

The repository creates exactly one `self` entity per owner lazily when the first memory is created.

### 3.2 Facts / Edges

`app.memory_facts` stores claims or relationships.

Shape:

- `subject_entity_id`
- `predicate`
- one of:
  - `object_entity_id`
  - `object_text`
- `confidence`: `0.00..1.00`
- `provenance`: `volunteered | inferred | confirmed | imported`
- `status`: `active | superseded | rejected`
- `valid_from`
- `valid_to`
- `last_confirmed_at`
- `importance`
- `pinned`
- `created_at`, `updated_at`

Examples:

- `Ben -> prefers -> concise mobile responses`
- `Ben -> works_on -> House project`
- `House project -> has_constraint -> budget ceiling`
- `Decision -> decided_for -> local Postgres memory graph`
- `Sarah -> related_to -> contractor bid`

The predicate is a constrained text enum in code, not an open-ended free-for-all in prompts. V1
predicates:

- `prefers`
- `works_on`
- `has_goal`
- `has_constraint`
- `decided`
- `related_to`
- `owes`
- `waiting_on`
- `mentioned_in`
- `alias_of`

Add predicates only when a feature needs them.

### 3.3 Episodes / Sources

`app.memory_episodes` stores evidence that produced memory.

Episode kinds:

- `chat`
- `note`
- `task`
- `email`
- `calendar`
- `manual`

Core fields:

- `id`
- `owner_user_id`
- `source_kind`
- `source_ref`: thread id, note path, task id, message id, event id, or manual marker
- `source_label`
- `occurred_at`
- `excerpt`
- `created_at`

`app.memory_fact_sources` links facts to one or more episodes. A fact without evidence is not
trusted memory; manual memory gets a `manual` episode.

### 3.4 Aliases

`app.memory_aliases` maps names to entities:

- nicknames: "Sarah"
- email addresses
- project shorthands: "house project", "remodel"
- normalized labels

Alias uniqueness is owner-scoped. Collisions are allowed only when explicitly marked ambiguous and
must not auto-resolve.

### 3.5 Search Documents

`app.memory_search_documents` stores one searchable document per entity/fact/episode summary:

- `target_kind`: `entity | fact | episode`
- `target_id`
- `search_text`
- `embedding` using the existing configured embedding provider and pgvector
- `created_at`, `updated_at`

V1 recall uses hybrid ranking: keyword text match, vector similarity, pinned/importance/provenance
boosts, and freshness. If the configured embedding provider is `stub`, vector results are
mechanically valid but low quality; the API still behaves the same and improves when the provider is
upgraded.

## 4. Recall Contract

Create `packages/memory/src/graph-recall-service.ts`.

Public methods:

```ts
interface MemoryRecallService {
  remember(scopedDb, ownerUserId, input): Promise<MemoryWriteResult>;
  recall(scopedDb, ownerUserId, query, options?): Promise<MemoryRecallResult>;
  forget(scopedDb, ownerUserId, target): Promise<MemoryForgetResult>;
  supersede(scopedDb, ownerUserId, input): Promise<MemoryWriteResult>;
  link(scopedDb, ownerUserId, input): Promise<MemoryWriteResult>;
  pin(scopedDb, ownerUserId, target, pinned): Promise<void>;
}
```

V1 implementation can be a class backed by repositories, not an interface hierarchy.

`recall()` returns assembled context, not raw rows:

```ts
interface MemoryRecallResult {
  readonly query: string;
  readonly items: readonly MemoryRecallItem[];
}

interface MemoryRecallItem {
  readonly kind: "entity" | "fact" | "episode";
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly score: number;
  readonly confidence: number;
  readonly provenance: "volunteered" | "inferred" | "confirmed" | "imported";
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
  readonly sources: readonly MemorySourceSummary[];
}
```

Ranking order:

1. pinned active memory;
2. confirmed/volunteered over inferred;
3. query match;
4. importance;
5. freshness / last confirmed.

Rejected, superseded, archived, and expired memories do not appear unless `includeInactive` is set.

## 5. Core vs Archival Memory

Jarvis gets two recall modes:

- **Core memory:** tiny, high-confidence, always-eligible seed. Includes pinned facts, confirmed
  preferences, active goals, and recurring constraints. Hard cap: 20 items.
- **Query recall:** search over the full memory graph for a prompt, project, person, or task.

#528 builds both modes in the memory package. #530 decides when chat calls query recall
automatically.

## 6. Migration From Existing Facts

Do not delete `app.chat_memory_facts` in this slice.

V1 adds a forward migration that:

1. creates the graph tables;
2. leaves existing facts in place;
3. backfills active `chat_memory_facts` with this fixed mapping:
   - create one owner-scoped `self` entity named `Self`;
   - map `category=preference` to predicate `prefers`;
   - map `category=goal` to predicate `has_goal`;
   - map `category=profile` to predicate `related_to`;
   - map `category=fact` to predicate `related_to`;
   - store the legacy fact content as `object_text`;
   - create a `chat` episode when `source_thread_id` exists, else `manual`;
   - link the new memory fact to that episode;
4. marks migrated legacy facts by inserting a source link, not by editing applied migrations.

After graph recall is live, old `listActiveFacts` remains for compatibility until consumers move.

## 7. API And Tool Surface

V1 backend routes:

- `GET /api/memory/graph/recall?q=...`
- `GET /api/memory/graph/core`
- `POST /api/memory/graph/entities`
- `POST /api/memory/graph/facts`
- `POST /api/memory/graph/facts/:id/pin`
- `POST /api/memory/graph/facts/:id/supersede`
- `DELETE /api/memory/graph/facts/:id`

V1 assistant tools:

- `memory.recall` (`risk: read`)
- `memory.remember` (`risk: write`, confirmation governed by the existing action policy)
- `memory.forget` (`risk: destructive`, always confirms)

No auto-distillation in this spec. #529 owns background extraction into this graph.

## 8. Security And Invariants

- All tables are owner-scoped and FORCE RLS.
- Runtime app and worker roles get only the minimum grants needed.
- Admins do not bypass RLS.
- Job payloads stay metadata-only. Source excerpts live in owner-scoped DB rows, not job payloads.
- Secrets never enter memory episodes or search documents.
- Email/calendar/task content stored as evidence must be excerpts, not full private objects, unless
  a later spec explicitly justifies full-source retention.
- `memory.forget` must remove or deactivate graph records and their search documents for the owner.
- Data export and account deletion must include the graph tables.

## 9. Out Of Scope

- Automatic chat distillation (#529).
- Passive retrieval before every answer (#530).
- Full confidence/staleness UX (#532).
- Editable dashboard (#533).
- Commitment extraction (#537).
- Person/contact graph enrichment beyond aliases (#538).
- Source-backed answer UI beyond returning source summaries (#539).
- A Neo4j/Graphiti/Cognee external service.
- Multi-user shared memory.

## 10. Acceptance Criteria

- [ ] Graph memory tables exist with owner-scoped FORCE RLS.
- [ ] Existing active `chat_memory_facts` can be represented in the graph model.
- [ ] `MemoryRecallService.recall()` returns ranked, source-backed items for a query.
- [ ] `MemoryRecallService` can create, supersede, forget, link, and pin memory.
- [ ] Core memory returns a capped high-confidence set for chat seeding.
- [ ] Assistant tool `memory.recall` can retrieve graph memory without exposing cross-user data.
- [ ] Assistant tool `memory.forget` always confirms.
- [ ] Integration tests prove user A cannot read, write, update, or forget user B's memory graph.
- [ ] Data export/account deletion include the graph memory tables.
- [ ] Legacy `chat_memory_facts` consumers continue to work until migrated.

## 11. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:memory
pnpm test:chat
```

Targeted tests:

- repository CRUD and RLS tests for entities/facts/episodes/aliases/search documents;
- recall ranking unit test for pinned/confirmed/query/importance ordering;
- backfill test from `chat_memory_facts`;
- assistant tool tests for recall/remember/forget policies;
- export/delete coverage for new tables.
