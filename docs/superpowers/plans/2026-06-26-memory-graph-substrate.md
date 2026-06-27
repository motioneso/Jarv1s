# Memory Graph Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` to implement this plan task-by-task under `coordinated-build`. Coordinator approval is required before code changes. `subagent-driven-development` and `executing-plans` are disabled for this repo's coordinated builds.

**Goal:** Build the owner-scoped Postgres memory graph substrate from approved issue #528 without breaking existing flat chat-memory consumers.

**Architecture:** Add graph tables and RLS in the memory module, then layer a small repository/service/API/tool surface over those tables. Keep existing `app.chat_memory_facts` and `ChatMemoryFactsRepository.listActiveFacts()` untouched; the graph backfill reads legacy facts but does not move current callers yet.

**Tech Stack:** TypeScript, Fastify, Kysely raw SQL, Postgres RLS, pgvector, Vitest, existing `DataContextDb`/`AccessContext`.

---

## Grounding Summary

- Branch: `rfa-528-memory-graph-substrate`.
- Current graph tables are absent: `app.memory_entities`, `app.memory_facts`, `app.memory_episodes`, `app.memory_fact_sources`, `app.memory_aliases`, `app.memory_search_documents`, `app.memory_legacy_fact_migrations`.
- Legacy `app.chat_memory_facts` is active and has consumers in chat recall, chat routes, fact extraction, and wellness recall. Do not migrate those callers in #528.
- Existing `MemoryRepository` owns vault/chat chunk embeddings only. Do not fold graph memory into it.
- Export/delete hooks are centralized in `packages/settings/src/data-export.ts` and `scripts/delete-user-data.ts`.
- Assistant tool confirmation policy already makes destructive tools confirm; `memory.forget` should use `risk: "destructive"`.
- Migration versions are global across module directories. Current checked-in high version is `0117_provider_execution_mode.sql`; use proposed `packages/memory/sql/0118_memory_graph_substrate.sql` only if Coordinator confirms it is still free.

## Files

- Create: `packages/memory/sql/0118_memory_graph_substrate.sql` after Coordinator confirms migration number.
- Create: `packages/memory/src/graph-types.ts`.
- Create: `packages/memory/src/graph-repository.ts`.
- Create: `packages/memory/src/graph-recall-service.ts`.
- Create: `packages/memory/src/graph-routes.ts`.
- Create: `packages/memory/src/graph-tools.ts`.
- Create: `packages/shared/src/memory-graph-api.ts`.
- Create: `tests/integration/memory-graph.test.ts`.
- Modify: `packages/memory/package.json`.
- Modify: `packages/memory/src/index.ts`.
- Modify: `packages/memory/src/manifest.ts`.
- Modify: `packages/module-registry/src/index.ts`.
- Modify: `packages/shared/src/index.ts`.
- Modify: `packages/settings/src/data-export.ts`.
- Modify: `scripts/delete-user-data.ts`.
- Modify: `tests/integration/release-hardening.test.ts`.
- Modify: `tests/integration/ai-tools.test.ts`.
- Modify: `tests/unit/route-coverage.test.ts`.
- Modify: `package.json`.

## Coordinator Decision Needed

Approve or replace migration filename `packages/memory/sql/0118_memory_graph_substrate.sql`. If another lane owns `0118`, rename this plan's migration path before implementation and use that assigned number everywhere.

### Task 1: Schema, RLS, and Legacy Backfill

**Files:**

- Create: `packages/memory/sql/0118_memory_graph_substrate.sql`
- Create: `tests/integration/memory-graph.test.ts`
- Modify: `packages/memory/src/manifest.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing schema/RLS tests**

Add `tests/integration/memory-graph.test.ts` with:

```ts
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import pg from "pg";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;
const graphTables = [
  "memory_entities",
  "memory_facts",
  "memory_episodes",
  "memory_fact_sources",
  "memory_aliases",
  "memory_search_documents",
  "memory_legacy_fact_migrations"
] as const;

let appDb: Kysely<JarvisDatabase>;
let workerDb: Kysely<JarvisDatabase>;
let migrationDb: Kysely<JarvisDatabase>;
let appDataContext: DataContextRunner;
let workerDataContext: DataContextRunner;

beforeAll(async () => {
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });
  migrationDb = createDatabase({
    connectionString: connectionStrings.migration,
    maxConnections: 1
  });
  appDataContext = new DataContextRunner(appDb);
  workerDataContext = new DataContextRunner(workerDb);
});

afterAll(async () => {
  await appDb?.destroy();
  await workerDb?.destroy();
  await migrationDb?.destroy();
});

describe("memory graph schema and RLS", () => {
  it("creates owner-scoped FORCE RLS tables for app and worker roles", async () => {
    const tables = await sql<{ table_name: string; force_rls: boolean }>`
      SELECT c.relname AS table_name, c.relforcerowsecurity AS force_rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app'
        AND c.relname IN (${sql.join(graphTables)})
      ORDER BY c.relname
    `.execute(migrationDb);

    expect(tables.rows.map((r) => r.table_name)).toEqual([...graphTables].sort());
    expect(tables.rows.every((r) => r.force_rls)).toBe(true);

    const policies = await sql<{ table_name: string; role_name: string }>`
      SELECT c.relname AS table_name, g.rolname AS role_name
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      CROSS JOIN LATERAL unnest(p.polroles) AS role_oid(oid)
      JOIN pg_roles g ON g.oid = role_oid.oid
      WHERE c.relname IN (${sql.join(graphTables)})
      ORDER BY c.relname, g.rolname
    `.execute(migrationDb);

    for (const table of graphTables) {
      const roles = policies.rows.filter((r) => r.table_name === table).map((r) => r.role_name);
      expect(roles).toContain("jarvis_app_runtime");
      expect(roles).toContain("jarvis_worker_runtime");
    }
  });

  it("prevents cross-user reads and writes through app and worker roles", async () => {
    await expectGraphIsolation(appDataContext, "app");
    await expectGraphIsolation(workerDataContext, "worker");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/memory-graph.test.ts
```

Expected: FAIL because graph tables do not exist.

- [ ] **Step 3: Add graph migration**

Create `packages/memory/sql/0118_memory_graph_substrate.sql` with:

```sql
CREATE TABLE IF NOT EXISTS app.memory_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('person','project','preference','goal','constraint','decision','topic','place','organization','self')),
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','merged')),
  importance NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (importance BETWEEN 0.00 AND 1.00),
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_entities_one_self_per_owner_idx
  ON app.memory_entities (owner_user_id)
  WHERE kind = 'self';

CREATE INDEX IF NOT EXISTS memory_entities_owner_status_idx
  ON app.memory_entities (owner_user_id, status, kind);

CREATE TABLE IF NOT EXISTS app.memory_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  subject_entity_id UUID NOT NULL,
  predicate TEXT NOT NULL CHECK (predicate IN ('prefers','works_on','has_goal','has_constraint','decided','related_to','owes','waiting_on','mentioned_in','alias_of')),
  object_entity_id UUID,
  object_text TEXT,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.60 CHECK (confidence BETWEEN 0.00 AND 1.00),
  provenance TEXT NOT NULL DEFAULT 'inferred' CHECK (provenance IN ('volunteered','inferred','confirmed','imported')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','rejected')),
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  last_confirmed_at TIMESTAMPTZ,
  importance NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (importance BETWEEN 0.00 AND 1.00),
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((object_entity_id IS NULL) <> (object_text IS NULL)),
  UNIQUE (owner_user_id, id),
  FOREIGN KEY (owner_user_id, subject_entity_id)
    REFERENCES app.memory_entities(owner_user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id, object_entity_id)
    REFERENCES app.memory_entities(owner_user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS memory_facts_owner_status_idx
  ON app.memory_facts (owner_user_id, status, pinned, importance);
CREATE INDEX IF NOT EXISTS memory_facts_subject_idx
  ON app.memory_facts (owner_user_id, subject_entity_id);

CREATE TABLE IF NOT EXISTS app.memory_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('chat','note','task','email','calendar','manual')),
  source_ref TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ,
  excerpt TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, id)
);

CREATE INDEX IF NOT EXISTS memory_episodes_owner_kind_idx
  ON app.memory_episodes (owner_user_id, source_kind, occurred_at DESC);

CREATE TABLE IF NOT EXISTS app.memory_fact_sources (
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  fact_id UUID NOT NULL,
  episode_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, fact_id, episode_id),
  FOREIGN KEY (owner_user_id, fact_id)
    REFERENCES app.memory_facts(owner_user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id, episode_id)
    REFERENCES app.memory_episodes(owner_user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.memory_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  ambiguous BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_user_id, entity_id)
    REFERENCES app.memory_entities(owner_user_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_aliases_owner_unambiguous_idx
  ON app.memory_aliases (owner_user_id, normalized_alias)
  WHERE ambiguous = false;

CREATE TABLE IF NOT EXISTS app.memory_search_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('entity','fact','episode')),
  target_id UUID NOT NULL,
  search_text TEXT NOT NULL,
  embedding vector(768),
  embed_model_name TEXT,
  embed_model_version TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS memory_search_documents_owner_status_idx
  ON app.memory_search_documents (owner_user_id, status, target_kind);

CREATE INDEX IF NOT EXISTS memory_search_documents_embedding_idx
  ON app.memory_search_documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE IF NOT EXISTS app.memory_legacy_fact_migrations (
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  legacy_fact_id UUID NOT NULL REFERENCES app.chat_memory_facts(id) ON DELETE CASCADE,
  memory_fact_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, legacy_fact_id),
  FOREIGN KEY (owner_user_id, memory_fact_id)
    REFERENCES app.memory_facts(owner_user_id, id) ON DELETE CASCADE
);
```

Then add RLS/policies/grants for every graph table:

```sql
ALTER TABLE app.memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_entities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_entities_owner ON app.memory_entities;
CREATE POLICY memory_entities_owner ON app.memory_entities
  TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_entities TO jarvis_app_runtime, jarvis_worker_runtime;
```

Repeat the same owner policy/grants for `memory_facts`, `memory_episodes`, `memory_fact_sources`, `memory_aliases`, `memory_search_documents`, and `memory_legacy_fact_migrations`.

Add idempotent legacy backfill at the bottom:

```sql
WITH owners AS (
  SELECT DISTINCT owner_user_id FROM app.chat_memory_facts WHERE status = 'active'
),
self_entities AS (
  INSERT INTO app.memory_entities (owner_user_id, kind, name, summary)
  SELECT owner_user_id, 'self', 'Self', 'Owner self memory root'
  FROM owners
  ON CONFLICT (owner_user_id) WHERE kind = 'self' DO NOTHING
  RETURNING owner_user_id, id
)
SELECT 1;
```

Use the real column list from the final schema. Continue with `INSERT ... SELECT` for active legacy facts:

- predicate mapping: `preference -> prefers`, `goal -> has_goal`, `profile -> related_to`, `fact -> related_to`;
- `object_text = chat_memory_facts.content`;
- `source_kind = 'chat'` when `source_thread_id IS NOT NULL`, else `'manual'`;
- `source_ref = COALESCE(source_thread_id::text, 'legacy-chat-memory-fact:' || id::text)`;
- insert one source row per migrated fact;
- insert `memory_legacy_fact_migrations` with `ON CONFLICT DO NOTHING`.

- [ ] **Step 4: Update manifest and test script**

In `packages/memory/src/manifest.ts`, add all graph owned tables to `database.ownedTables`. Keep `migrationDirectories: ["packages/memory/sql"]`.

In `package.json`, change:

```json
"test:memory": "vitest run tests/integration/memory.test.ts tests/integration/memory-facts-rls.test.ts tests/integration/memory-graph.test.ts"
```

- [ ] **Step 5: Run schema tests**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm test:memory
```

Expected: PASS for schema/RLS tests.

Commit:

```bash
git add packages/memory/sql/0118_memory_graph_substrate.sql packages/memory/src/manifest.ts tests/integration/memory-graph.test.ts package.json
git commit -m "feat: add memory graph schema"
```

### Task 2: Graph Repository and Types

**Files:**

- Create: `packages/memory/src/graph-types.ts`
- Create: `packages/memory/src/graph-repository.ts`
- Modify: `packages/memory/src/index.ts`
- Modify: `tests/integration/memory-graph.test.ts`

- [ ] **Step 1: Write failing repository tests**

Extend `tests/integration/memory-graph.test.ts`:

```ts
import { MemoryGraphRepository, type MemoryFactPredicate } from "@jarv1s/memory";

describe("MemoryGraphRepository", () => {
  const repo = new MemoryGraphRepository();

  it("creates one self entity per owner and survives repeated calls", async () => {
    const selfA = await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "memory-graph:self-a" },
      (db) => repo.ensureSelfEntity(db, ids.userA)
    );
    const selfB = await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "memory-graph:self-b" },
      (db) => repo.ensureSelfEntity(db, ids.userA)
    );

    expect(selfB.id).toBe(selfA.id);
  });

  it("creates source-backed facts, links, aliases, and search documents", async () => {
    await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "memory-graph:repo" },
      async (db) => {
        const project = await repo.createEntity(db, ids.userA, {
          kind: "project",
          name: "House project",
          summary: "Kitchen remodel",
          importance: 0.7,
          pinned: false
        });
        await repo.addAlias(db, ids.userA, project.id, "remodel", false);
        const fact = await repo.createFact(db, ids.userA, {
          subjectEntityId: project.id,
          predicate: "has_constraint" satisfies MemoryFactPredicate,
          objectText: "budget ceiling is 50k",
          confidence: 0.9,
          provenance: "confirmed",
          importance: 0.8,
          pinned: true,
          source: {
            sourceKind: "manual",
            sourceRef: "manual:test",
            sourceLabel: "Manual test",
            excerpt: "Budget ceiling is 50k"
          }
        });

        const docs = await repo.listSearchDocumentsForOwner(db, ids.userA);
        expect(fact.sources).toHaveLength(1);
        expect(docs.map((d) => `${d.targetKind}:${d.targetId}`)).toContain(`entity:${project.id}`);
        expect(docs.map((d) => `${d.targetKind}:${d.targetId}`)).toContain(`fact:${fact.id}`);
      }
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/memory-graph.test.ts
```

Expected: FAIL because repository/types do not exist.

- [ ] **Step 3: Add graph types**

Create `packages/memory/src/graph-types.ts` with exported unions and input/result types:

```ts
export const memoryEntityKinds = [
  "person",
  "project",
  "preference",
  "goal",
  "constraint",
  "decision",
  "topic",
  "place",
  "organization",
  "self"
] as const;

export type MemoryEntityKind = (typeof memoryEntityKinds)[number];
export type MemoryEntityStatus = "active" | "archived" | "merged";
export type MemoryFactPredicate =
  | "prefers"
  | "works_on"
  | "has_goal"
  | "has_constraint"
  | "decided"
  | "related_to"
  | "owes"
  | "waiting_on"
  | "mentioned_in"
  | "alias_of";
export type MemoryFactProvenance = "volunteered" | "inferred" | "confirmed" | "imported";
export type MemoryFactStatus = "active" | "superseded" | "rejected";
export type MemoryEpisodeKind = "chat" | "note" | "task" | "email" | "calendar" | "manual";

export interface MemorySourceInput {
  readonly sourceKind: MemoryEpisodeKind;
  readonly sourceRef: string;
  readonly sourceLabel?: string;
  readonly occurredAt?: Date | null;
  readonly excerpt: string;
}

export interface MemoryEntityRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly kind: MemoryEntityKind;
  readonly name: string;
  readonly summary: string;
  readonly status: MemoryEntityStatus;
  readonly importance: number;
  readonly pinned: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MemoryFactRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly subjectEntityId: string;
  readonly predicate: MemoryFactPredicate;
  readonly objectEntityId: string | null;
  readonly objectText: string | null;
  readonly confidence: number;
  readonly provenance: MemoryFactProvenance;
  readonly status: MemoryFactStatus;
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
  readonly lastConfirmedAt: Date | null;
  readonly importance: number;
  readonly pinned: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly sources: readonly MemorySourceSummary[];
}
```

- [ ] **Step 4: Add repository**

Create `packages/memory/src/graph-repository.ts` using `assertDataContextDb(scopedDb)` and raw `sql`.

Required methods:

- `ensureSelfEntity(scopedDb, ownerUserId)`;
- `createEntity(scopedDb, ownerUserId, input)`;
- `addAlias(scopedDb, ownerUserId, entityId, alias, ambiguous)`;
- `createFact(scopedDb, ownerUserId, input)`; require exactly one object target and a source;
- `supersedeFact(scopedDb, ownerUserId, factId, validTo?)`;
- `forgetFact(scopedDb, ownerUserId, factId)`;
- `pinFact(scopedDb, ownerUserId, factId, pinned)`;
- `listSearchDocumentsForOwner(scopedDb, ownerUserId)`;
- `upsertSearchDocument(scopedDb, ownerUserId, targetKind, targetId, searchText, embedding?, model?)`;
- `deactivateSearchDocument(scopedDb, ownerUserId, targetKind, targetId)`.

Keep mapping helpers private in the same file. Do not add a repository interface.

- [ ] **Step 5: Export repository/types**

Update `packages/memory/src/index.ts`:

```ts
export * from "./graph-types.js";
export { MemoryGraphRepository } from "./graph-repository.js";
```

- [ ] **Step 6: Run repository tests**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/memory-graph.test.ts
```

Expected: PASS for repository tests.

Commit:

```bash
git add packages/memory/src/graph-types.ts packages/memory/src/graph-repository.ts packages/memory/src/index.ts tests/integration/memory-graph.test.ts
git commit -m "feat: add memory graph repository"
```

### Task 3: Recall Service and Ranking

**Files:**

- Create: `packages/memory/src/graph-recall-service.ts`
- Modify: `packages/memory/src/index.ts`
- Modify: `tests/integration/memory-graph.test.ts`

- [ ] **Step 1: Write failing service tests**

Extend `tests/integration/memory-graph.test.ts`:

```ts
import { GraphMemoryRecallService, StubEmbeddingProvider } from "@jarv1s/memory";

describe("GraphMemoryRecallService", () => {
  it("recalls ranked, active, source-backed memory for a query", async () => {
    const service = new GraphMemoryRecallService(new StubEmbeddingProvider());

    const result = await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "memory-graph:recall" },
      async (db) => {
        const written = await service.remember(db, ids.userA, {
          predicate: "prefers",
          objectText: "concise mobile responses",
          confidence: 0.95,
          provenance: "confirmed",
          importance: 0.9,
          pinned: true,
          source: {
            sourceKind: "manual",
            sourceRef: "manual:recall-test",
            sourceLabel: "Manual memory",
            excerpt: "Ben prefers concise mobile responses."
          }
        });
        await service.remember(db, ids.userA, {
          predicate: "related_to",
          objectText: "low priority unrelated fact",
          confidence: 0.4,
          provenance: "inferred",
          importance: 0.1,
          source: {
            sourceKind: "manual",
            sourceRef: "manual:noise",
            excerpt: "Noise"
          }
        });
        return { written, recalled: await service.recall(db, ids.userA, "mobile responses") };
      }
    );

    expect(result.recalled.items[0]).toMatchObject({
      kind: "fact",
      id: result.written.fact.id,
      provenance: "confirmed",
      confidence: 0.95
    });
    expect(result.recalled.items[0]?.sources.length).toBeGreaterThan(0);
  });

  it("returns capped core memory and excludes superseded or forgotten facts", async () => {
    const service = new GraphMemoryRecallService(new StubEmbeddingProvider());

    const result = await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "memory-graph:core" },
      async (db) => {
        const write = await service.remember(db, ids.userA, {
          predicate: "has_goal",
          objectText: `goal ${randomUUID()}`,
          confidence: 0.9,
          provenance: "confirmed",
          importance: 0.9,
          pinned: true,
          source: { sourceKind: "manual", sourceRef: "manual:core", excerpt: "Core goal" }
        });
        await service.supersede(db, ids.userA, { factId: write.fact.id });
        return { supersededId: write.fact.id, core: await service.core(db, ids.userA) };
      }
    );

    expect(result.core.items.map((item) => item.id)).not.toContain(result.supersededId);
    expect(result.core.items.length).toBeLessThanOrEqual(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/memory-graph.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Add service**

Create `packages/memory/src/graph-recall-service.ts`:

```ts
import { assertDataContextDb } from "@jarv1s/db";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { MemoryGraphRepository } from "./graph-repository.js";
import type {
  MemoryRecallResult,
  MemoryRememberInput,
  MemorySupersedeInput
} from "./graph-types.js";

export class GraphMemoryRecallService {
  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly repository = new MemoryGraphRepository()
  ) {}

  async remember(scopedDb: unknown, ownerUserId: string, input: MemoryRememberInput) {
    assertDataContextDb(scopedDb);
    const subject = input.subjectEntityId
      ? await this.repository.getEntity(scopedDb, ownerUserId, input.subjectEntityId)
      : await this.repository.ensureSelfEntity(scopedDb, ownerUserId);
    const fact = await this.repository.createFact(scopedDb, ownerUserId, {
      ...input,
      subjectEntityId: subject.id
    });
    await this.indexFact(scopedDb, ownerUserId, fact.id);
    return { fact };
  }

  async recall(
    scopedDb: unknown,
    ownerUserId: string,
    query: string,
    options: { readonly limit?: number; readonly includeInactive?: boolean } = {}
  ): Promise<MemoryRecallResult> {
    assertDataContextDb(scopedDb);
    const embedding = await this.embeddingProvider.embedQuery(query);
    const items = await this.repository.recall(scopedDb, ownerUserId, query, embedding, options);
    return { query, items };
  }

  async core(scopedDb: unknown, ownerUserId: string): Promise<MemoryRecallResult> {
    assertDataContextDb(scopedDb);
    const items = await this.repository.core(scopedDb, ownerUserId, 20);
    return { query: "", items };
  }

  async forget(scopedDb: unknown, ownerUserId: string, target: { readonly factId: string }) {
    assertDataContextDb(scopedDb);
    return this.repository.forgetFact(scopedDb, ownerUserId, target.factId);
  }

  async supersede(scopedDb: unknown, ownerUserId: string, input: MemorySupersedeInput) {
    assertDataContextDb(scopedDb);
    await this.repository.supersedeFact(scopedDb, ownerUserId, input.factId, input.validTo);
    return { factId: input.factId };
  }

  async link(scopedDb: unknown, ownerUserId: string, input: MemoryRememberInput) {
    return this.remember(scopedDb, ownerUserId, input);
  }

  async pin(
    scopedDb: unknown,
    ownerUserId: string,
    target: { readonly factId: string },
    pinned: boolean
  ) {
    assertDataContextDb(scopedDb);
    await this.repository.pinFact(scopedDb, ownerUserId, target.factId, pinned);
  }
}
```

Fill `indexFact` and repository `recall/core` with the explicit linear score from the spec:

```txt
(0.40 * vectorSimilarity) + (0.25 * keywordMatch) + (0.15 * importance) + (0.10 * provenanceBoost) + (0.05 * pinnedBoost) + (0.05 * freshnessBoost)
```

Rejected, superseded, archived, and expired rows stay hidden unless `includeInactive` is true.

- [ ] **Step 4: Export service**

Update `packages/memory/src/index.ts`:

```ts
export { GraphMemoryRecallService } from "./graph-recall-service.js";
```

- [ ] **Step 5: Run service tests**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/memory-graph.test.ts
```

Expected: PASS.

Commit:

```bash
git add packages/memory/src/graph-recall-service.ts packages/memory/src/graph-types.ts packages/memory/src/graph-repository.ts packages/memory/src/index.ts tests/integration/memory-graph.test.ts
git commit -m "feat: add graph memory recall service"
```

### Task 4: Backend Graph API Routes

**Files:**

- Create: `packages/shared/src/memory-graph-api.ts`
- Create: `packages/memory/src/graph-routes.ts`
- Modify: `packages/memory/package.json`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/memory/src/index.ts`
- Modify: `packages/memory/src/manifest.ts`
- Modify: `packages/module-registry/src/index.ts`
- Modify: `tests/integration/memory-graph.test.ts`
- Modify: `tests/unit/route-coverage.test.ts`

- [ ] **Step 1: Write failing route tests**

Add Fastify route tests in `tests/integration/memory-graph.test.ts` that register `registerMemoryGraphRoutes()` and assert:

- `GET /api/memory/graph/recall?q=mobile` returns only actor-owned items;
- `GET /api/memory/graph/core` returns max 20;
- `POST /api/memory/graph/entities` creates an owned entity;
- `POST /api/memory/graph/facts` creates a source-backed fact;
- `POST /api/memory/graph/facts/:id/pin` toggles pinned;
- `POST /api/memory/graph/facts/:id/supersede` hides the fact from default recall;
- `DELETE /api/memory/graph/facts/:id` cannot delete another user's fact and returns 404.

Add route-coverage expectations:

```ts
it("memory manifest declares graph API routes", () => {
  const paths = manifestPaths("memory");
  for (const expected of [
    { method: "GET", path: "/api/memory/graph/recall" },
    { method: "GET", path: "/api/memory/graph/core" },
    { method: "POST", path: "/api/memory/graph/entities" },
    { method: "POST", path: "/api/memory/graph/facts" },
    { method: "POST", path: "/api/memory/graph/facts/:id/pin" },
    { method: "POST", path: "/api/memory/graph/facts/:id/supersede" },
    { method: "DELETE", path: "/api/memory/graph/facts/:id" }
  ]) {
    expect(paths).toContainEqual(expected);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/memory-graph.test.ts tests/unit/route-coverage.test.ts
```

Expected: FAIL because routes/contracts do not exist.

- [ ] **Step 3: Add shared route schemas**

Create `packages/shared/src/memory-graph-api.ts` with DTO interfaces and Fastify schemas for all graph routes. Export it from `packages/shared/src/index.ts`.

- [ ] **Step 4: Add route registration**

Add `@jarv1s/settings` to `packages/memory/package.json` dependencies so memory routes/tools reuse the existing `RuntimeConfigResolver` instead of duplicating runtime-config reads.

Create `packages/memory/src/graph-routes.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { RuntimeConfigResolver } from "@jarv1s/settings";
import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import {
  createEmbeddingProvider,
  getEmbeddingProviderConfig,
  GraphMemoryRecallService
} from "./index.js";

export interface MemoryGraphRouteDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
}

export function registerMemoryGraphRoutes(
  server: FastifyInstance,
  deps: MemoryGraphRouteDependencies
): void {
  server.get(
    "/api/memory/graph/recall",
    { schema: getMemoryGraphRecallRouteSchema },
    async (request, reply) => {
      try {
        const access = await deps.resolveAccessContext(request);
        const query = String((request.query as { q?: unknown }).q ?? "").trim();
        if (!query) return reply.code(400).send({ error: "q is required" });
        return deps.dataContext.withDataContext(access, async (db) => {
          const config = await getEmbeddingProviderConfig(new RuntimeConfigResolver(db));
          return new GraphMemoryRecallService(createEmbeddingProvider(config)).recall(
            db,
            access.actorUserId,
            query
          );
        });
      } catch (error) {
        return handleMemoryGraphRouteError(error, reply);
      }
    }
  );
}
```

Use the same `try/catch -> handleRouteError` style as chat/settings. Keep helper parsers local.

- [ ] **Step 5: Wire module manifest and registry**

In `packages/memory/src/manifest.ts`, add graph route declarations with permission IDs:

- read routes: `memory.view`;
- create/update/delete fact routes: `memory.manage`.

In `packages/module-registry/src/index.ts`, import and register:

```ts
registerRoutes: (server, deps) =>
  registerMemoryGraphRoutes(server, {
    dataContext: deps.dataContext,
    resolveAccessContext: deps.resolveAccessContext
  });
```

- [ ] **Step 6: Run route tests**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/memory-graph.test.ts tests/unit/route-coverage.test.ts
```

Expected: PASS.

Commit:

```bash
git add packages/shared/src/memory-graph-api.ts packages/shared/src/index.ts packages/memory/src/graph-routes.ts packages/memory/src/index.ts packages/memory/src/manifest.ts packages/module-registry/src/index.ts tests/integration/memory-graph.test.ts tests/unit/route-coverage.test.ts
git commit -m "feat: expose memory graph API"
```

### Task 5: Assistant Tools

**Files:**

- Create: `packages/memory/src/graph-tools.ts`
- Modify: `packages/memory/package.json`
- Modify: `packages/memory/src/index.ts`
- Modify: `packages/memory/src/manifest.ts`
- Modify: `tests/integration/ai-tools.test.ts`

- [ ] **Step 1: Write failing assistant tool tests**

Extend `tests/integration/ai-tools.test.ts`:

```ts
it("executes memory.recall through owner-scoped graph memory", async () => {
  await seedMemoryGraphToolData();
  const recall = await invokeTool("memory.recall", userAHeaders(), { query: "mobile responses" });
  expect(recall.status).toBe("succeeded");
  expect(JSON.stringify(recall.result)).toContain("mobile responses");
  expect(JSON.stringify(recall.result)).not.toContain("User B graph memory");
});

it("always confirms memory.forget before deleting graph memory", async () => {
  await seedMemoryGraphToolData();
  const response = await server.inject({
    method: "POST",
    url: "/api/ai/assistant-tools/memory.forget/invoke",
    headers: userAHeaders(),
    payload: { input: { factId: "78000000-0000-4000-8000-000000000001" } }
  });
  const invocation = response.json<InvocationResponse>().invocation;
  expect(response.statusCode).toBe(403);
  expect(invocation).toMatchObject({
    moduleId: "memory",
    name: "memory.forget",
    risk: "destructive",
    status: "blocked",
    blockedReason: "confirmation_required",
    result: null
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/ai-tools.test.ts
```

Expected: FAIL because memory tools are absent.

- [ ] **Step 3: Add tools**

Create `packages/memory/src/graph-tools.ts`:

```ts
import { assertDataContextDb } from "@jarv1s/db";
import { RuntimeConfigResolver } from "@jarv1s/settings";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import {
  createEmbeddingProvider,
  getEmbeddingProviderConfig
} from "./embedding-provider-config.js";
import { GraphMemoryRecallService } from "./graph-recall-service.js";

async function service(scopedDb: Parameters<ToolExecute>[0]): Promise<GraphMemoryRecallService> {
  assertDataContextDb(scopedDb);
  const config = await getEmbeddingProviderConfig(new RuntimeConfigResolver(scopedDb));
  return new GraphMemoryRecallService(createEmbeddingProvider(config));
}

export const memoryRecallExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const query =
    typeof (input as { query?: unknown }).query === "string"
      ? (input as { query: string }).query.trim()
      : "";
  if (!query) return { data: { query: "", items: [] } };
  return { data: await (await service(scopedDb)).recall(scopedDb, ctx.actorUserId, query) };
};

export const memoryRememberExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const result = await (
    await service(scopedDb)
  ).remember(scopedDb, ctx.actorUserId, parseRememberInput(input));
  return { data: { factId: result.fact.id } };
};

export const memoryForgetExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const factId =
    typeof (input as { factId?: unknown }).factId === "string"
      ? (input as { factId: string }).factId
      : "";
  if (!factId) return { data: { deleted: false } };
  return { data: await (await service(scopedDb)).forget(scopedDb, ctx.actorUserId, { factId }) };
};
```

Keep `parseRememberInput` local and strict.

- [ ] **Step 4: Register tools in manifest**

In `packages/memory/src/manifest.ts`, add assistant tools:

```ts
assistantTools: [
  {
    name: "memory.recall",
    description: "Recall source-backed graph memory owned by the active actor.",
    permissionId: "memory.view",
    risk: "read",
    inputSchema: {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: { query: { type: "string" }, limit: { type: "number" } }
    },
    execute: memoryRecallExecute
  },
  {
    name: "memory.remember",
    description: "Create a source-backed graph memory fact for the active actor.",
    permissionId: "memory.manage",
    risk: "write",
    inputSchema: memoryRememberInputSchema,
    execute: memoryRememberExecute
  },
  {
    name: "memory.forget",
    description: "Forget a graph memory fact owned by the active actor.",
    permissionId: "memory.manage",
    risk: "destructive",
    inputSchema: {
      type: "object",
      required: ["factId"],
      additionalProperties: false,
      properties: { factId: { type: "string" } }
    },
    execute: memoryForgetExecute
  }
];
```

- [ ] **Step 5: Run assistant tool tests**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/ai-tools.test.ts
```

Expected: PASS.

Commit:

```bash
git add packages/memory/src/graph-tools.ts packages/memory/src/index.ts packages/memory/src/manifest.ts tests/integration/ai-tools.test.ts
git commit -m "feat: add memory graph assistant tools"
```

### Task 6: Export and Account Deletion

**Files:**

- Modify: `packages/settings/src/data-export.ts`
- Modify: `scripts/delete-user-data.ts`
- Modify: `tests/integration/release-hardening.test.ts`

- [ ] **Step 1: Write failing export/delete tests**

Extend `tests/integration/release-hardening.test.ts`:

- seed one graph entity/fact/episode/source/search document for `ids.userA`;
- assert `exportUserData()` includes `memoryEntities`, `memoryFacts`, `memoryEpisodes`, `memoryFactSources`, `memoryAliases`, and `memorySearchDocuments`;
- assert exported search docs do not include `embedding`;
- assert `deleteUserData()` dry-run counts include all graph tables;
- assert executed delete removes graph rows for user A and leaves user B rows.

Use direct bootstrap inserts in `seedExportExtensionData()`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/release-hardening.test.ts
```

Expected: FAIL because export/delete do not know graph tables.

- [ ] **Step 3: Add export tables**

In `packages/settings/src/data-export.ts`, add to `UserDataExportTables`:

```ts
readonly memoryEntities: readonly ExportRow[];
readonly memoryFacts: readonly ExportRow[];
readonly memoryEpisodes: readonly ExportRow[];
readonly memoryFactSources: readonly ExportRow[];
readonly memoryAliases: readonly ExportRow[];
readonly memorySearchDocuments: readonly ExportRow[];
readonly memoryLegacyFactMigrations: readonly ExportRow[];
```

Add corresponding query functions and `readExportTables()` entries. Omit `embedding`, `content_hash`, and `file_hash`-style derived fields from exports.

- [ ] **Step 4: Add delete counts**

In `scripts/delete-user-data.ts`, extend `userScopedCountQueries`:

```ts
["app.memory_entities", "owner_user_id = $1::uuid"],
["app.memory_facts", "owner_user_id = $1::uuid"],
["app.memory_episodes", "owner_user_id = $1::uuid"],
["app.memory_fact_sources", "owner_user_id = $1::uuid"],
["app.memory_aliases", "owner_user_id = $1::uuid"],
["app.memory_search_documents", "owner_user_id = $1::uuid"],
["app.memory_legacy_fact_migrations", "owner_user_id = $1::uuid"],
```

Actual deletion remains `DELETE FROM app.users`; schema FKs cascade.

- [ ] **Step 5: Run export/delete tests**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/release-hardening.test.ts
```

Expected: PASS.

Commit:

```bash
git add packages/settings/src/data-export.ts scripts/delete-user-data.ts tests/integration/release-hardening.test.ts
git commit -m "feat: include memory graph in export and deletion"
```

### Task 7: Final Verification

**Files:**

- No new files unless fixes are required.

- [ ] **Step 1: Run targeted memory/chat gates**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm test:memory
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm test:chat
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm vitest run tests/integration/ai-tools.test.ts tests/integration/release-hardening.test.ts tests/unit/route-coverage.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run static gates**

Run:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full foundation gate in lane DB**

Create DB if missing:

```bash
docker exec jarv1s-postgres psql -U postgres -c 'CREATE DATABASE jarvis_build_rfa_528_memory_graph;'
```

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph pnpm verify:foundation
```

Expected: PASS. If integration reset races with another lane, rerun once in the lane DB and report exact failing test if still red.

- [ ] **Step 4: Sync code graph**

Run:

```bash
codegraph sync .
```

Expected: exits 0.

- [ ] **Step 5: Stop for coordinated wrap-up**

After all tasks are implemented and verified, invoke `coordinated-wrap-up`. Do not move board items, close issues, merge, or touch `docs/coordination/`.

## Self-Review

- Spec coverage: schema/RLS, legacy backfill, service remember/recall/forget/supersede/link/pin, core memory, routes, tools, export/delete, legacy compatibility, and tests are covered.
- Placeholder scan: only migration filename is conditional and explicitly escalated to Coordinator because handoff forbids assuming global migration order.
- Boundary check: repositories use `DataContextDb`; no `AccessContext` shape changes; no raw `fs`; job payload invariant untouched; no provider/model hardcode.
