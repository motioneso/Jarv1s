# M-A1 Real Embeddings + Live Vault Ingestion — Implementation Plan

> **For agentic workers:** This plan is executed via Claude Code's built-in Agent workflow — a fresh
> subagent per task (model: **Sonnet**), with a review checkpoint between tasks. Steps use checkbox
> (`- [ ]`) syntax for tracking. The superpowers execution skills are disabled for this repo by design.

**Goal:** Replace the hash-based `StubEmbeddingProvider` with a real in-process
`LocalEmbeddingProvider` (`nomic-embed-text-v1.5`, 768-dim) and make vault ingestion idempotent,
incremental, provenance-tracked, and driven by a reusable `IngestionService` + thin CLI.

**Architecture:** All embedding work stays inside `@jarv1s/memory`. A new `EmbeddingProvider`
interface gains role-specific `embedDocument` / `embedQuery` methods plus `modelName` / `modelVersion`
provenance. A schema migration widens `memory_chunks.embedding` to `vector(768)`, adds provenance
columns, and introduces `app.memory_file_index` (file-level SHA-256 checkpoints for idempotency). A
new `IngestionService` owns the vault-scan loop, DataContextRunner lifecycle, error isolation, and
stats; a `scripts/ingest-vault.ts` CLI is its first thin caller.

**Tech Stack:** TypeScript (ESM, NodeNext), Kysely + Postgres + pgvector, `@huggingface/transformers`
(transformers.js / ONNX), Vitest integration tests, `tsx` for scripts.

**Spec:** `docs/superpowers/specs/m-a1-real-embeddings.md` (approved).

---

## Critical Correction vs. Spec

The spec proposed keeping `StubEmbeddingProvider` at 384 dims with the note "tests don't run
migration." **This is incorrect.** `tests/integration/test-database.ts::resetEmptyFoundationDatabase()`
runs every module's SQL migrations (via `getBuiltInSqlMigrationDirectories()`), including the new
`0031` migration. After `0031`, `app.memory_chunks.embedding` is `vector(768)`. Inserting a 384-dim
vector from the stub would raise `expected 768 dimensions, not 384`.

**Resolution applied throughout this plan:** `StubEmbeddingProvider.dimensions` becomes **768**. All
stub-based integration tests then insert 768-dim vectors that match the migrated column. The real
`LocalEmbeddingProvider` is also 768-dim, so the test and production schemas agree.

---

## File Structure (created / modified)

| Action | File                                                | Responsibility                                                                                   |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Modify | `packages/memory/package.json`                      | Add `@huggingface/transformers` dependency                                                       |
| Modify | `packages/memory/sql/0030_memory_index.sql`         | **Do not edit** (applied migration) — listed only as the table it builds on                      |
| Create | `packages/memory/sql/0031_memory_embedding_768.sql` | Widen to `vector(768)`, add provenance cols, add `memory_file_index` table + RLS + grants        |
| Modify | `packages/memory/src/manifest.ts`                   | Register new migration + owned table                                                             |
| Modify | `packages/db/src/types.ts`                          | Provenance cols on `MemoryChunksTable`; new `MemoryFileIndexTable`; register in `JarvisDatabase` |
| Modify | `packages/memory/src/embedding-provider.ts`         | New interface (`embedDocument`/`embedQuery`, `modelName`/`modelVersion`); stub → 768 dims        |
| Create | `packages/memory/src/local-embedding-provider.ts`   | `LocalEmbeddingProvider` (nomic-embed-text-v1.5)                                                 |
| Create | `packages/memory/src/embedding-provider-config.ts`  | `EmbeddingProviderConfig`, `createEmbeddingProvider`, `getEmbeddingProviderConfig`               |
| Modify | `packages/memory/src/repository.ts`                 | File-index methods; `upsertFileChunks` writes provenance                                         |
| Modify | `packages/memory/src/ingest.ts`                     | Idempotent `ingestFile`; `purgeDeletedFiles`; `deleteFile` clears index                          |
| Modify | `packages/memory/src/retrieval.ts`                  | Use `embedQuery`                                                                                 |
| Create | `packages/memory/src/ingestion-service.ts`          | `IngestionService` (scan loop, stats, error isolation)                                           |
| Modify | `packages/memory/src/index.ts`                      | Export new symbols                                                                               |
| Create | `scripts/ingest-vault.ts`                           | Thin CLI caller                                                                                  |
| Modify | `package.json` (root)                               | Add `ingest:vault` + `test:memory:local` scripts                                                 |
| Modify | `tests/integration/memory.test.ts`                  | Migrate to `embedDocument`/`embedQuery`; add idempotency/purge/service tests                     |
| Create | `tests/slow/memory-local-embed.test.ts`             | Real-embedding end-to-end test (excluded from `verify:foundation`)                               |

**Commit-green ordering:** Each task below leaves `pnpm verify:foundation` green. Task 2 is purely
additive (stub bumped to 768, `embed()` retained). Task 5 performs the interface cutover (removes
`embed()`) only after all in-process callers are migrated.

---

## Task 1: Add the embedding runtime dependency

**Files:**

- Modify: `packages/memory/package.json`

- [ ] **Step 1: Add the dependency**

Edit `packages/memory/package.json` — add `@huggingface/transformers` to `dependencies` (alphabetical
order, after `@jarv1s/vault`):

```json
  "dependencies": {
    "@jarv1s/db": "workspace:*",
    "@jarv1s/module-sdk": "workspace:*",
    "@jarv1s/vault": "workspace:*",
    "@huggingface/transformers": "^3.0.0",
    "kysely": "^0.29.2"
  },
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates; `node_modules/@huggingface/transformers` exists. No build errors.

- [ ] **Step 3: Verify it resolves**

Run: `node -e "import('@huggingface/transformers').then(m => console.log(typeof m.pipeline))"`
Expected: prints `function`

- [ ] **Step 4: Commit**

```bash
git add packages/memory/package.json pnpm-lock.yaml
git commit -m "build(memory): add @huggingface/transformers for local embeddings"
```

---

## Task 2: Schema migration to 768 dims + provenance + file-index table (additive, green)

This task widens the vector column, adds provenance, creates the idempotency table, updates Kysely
types, and bumps the stub to 768 — all without changing the embedding _interface_ yet. `embed()` is
retained so existing callers keep compiling.

**Files:**

- Create: `packages/memory/sql/0031_memory_embedding_768.sql`
- Modify: `packages/memory/src/manifest.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/memory/src/embedding-provider.ts`
- Test: `tests/integration/memory.test.ts` (stub dimension assertions)

- [ ] **Step 1: Write the migration**

Create `packages/memory/sql/0031_memory_embedding_768.sql`:

```sql
-- M-A1: widen embeddings to 768 dims (nomic-embed-text-v1.5), add model provenance,
-- and add a file-level ingestion checkpoint table for idempotent/incremental ingest.
-- memory_chunks is derived/rebuildable, so truncating to change vector width is safe.

-- HNSW index must be dropped before altering the vector dimension.
DROP INDEX IF EXISTS app.memory_chunks_embedding_idx;

-- Truncate derived data (fully rebuilt by ingestion).
TRUNCATE TABLE app.memory_chunks;
TRUNCATE TABLE app.memory_links;

ALTER TABLE app.memory_chunks
  ALTER COLUMN embedding TYPE vector(768);

ALTER TABLE app.memory_chunks
  ADD COLUMN IF NOT EXISTS embed_model_name    text,
  ADD COLUMN IF NOT EXISTS embed_model_version text;

CREATE INDEX memory_chunks_embedding_idx
  ON app.memory_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.memory_file_index (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id       uuid        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  source_kind         text        NOT NULL CHECK (source_kind IN ('vault', 'connector')),
  source_path         text        NOT NULL,
  file_hash           text        NOT NULL,
  chunk_count         integer     NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  embed_model_name    text        NOT NULL,
  embed_model_version text        NOT NULL,
  ingested_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, source_kind, source_path)
);

CREATE INDEX IF NOT EXISTS memory_file_index_owner_idx
  ON app.memory_file_index (owner_user_id, source_kind);

ALTER TABLE app.memory_file_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_file_index FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_file_index_select ON app.memory_file_index;
CREATE POLICY memory_file_index_select ON app.memory_file_index
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_insert ON app.memory_file_index;
CREATE POLICY memory_file_index_insert ON app.memory_file_index
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_update ON app.memory_file_index;
CREATE POLICY memory_file_index_update ON app.memory_file_index
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_delete ON app.memory_file_index;
CREATE POLICY memory_file_index_delete ON app.memory_file_index
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_file_index TO jarvis_app_runtime;
```

> Note: `0030` uses an unqualified `DROP INDEX IF EXISTS memory_chunks_embedding_idx`. The index lives
> in the `app` schema; `DROP INDEX IF EXISTS app.memory_chunks_embedding_idx` is the correct qualified
> form and works regardless of `search_path`.

- [ ] **Step 2: Register the migration in the manifest**

Edit `packages/memory/src/manifest.ts` — update the `database` block:

```ts
  database: {
    migrations: ["sql/0030_memory_index.sql", "sql/0031_memory_embedding_768.sql"],
    migrationDirectories: ["packages/memory/sql"],
    ownedTables: ["app.memory_chunks", "app.memory_links", "app.memory_file_index"]
  }
```

- [ ] **Step 3: Update Kysely types**

Edit `packages/db/src/types.ts`. Add the two provenance columns to `MemoryChunksTable`:

```ts
export interface MemoryChunksTable {
  id: string;
  owner_user_id: string;
  source_kind: "vault" | "connector";
  source_path: string;
  line_start: number;
  line_end: number;
  content_hash: string;
  text: string;
  embedding: string | null; // pgvector stored as text in Kysely; serialized as "[n,n,...]"
  embed_model_name: string | null;
  embed_model_version: string | null;
  updated_at: TimestampColumn;
}
```

Add a new interface immediately after `MemoryLinksTable`:

```ts
export interface MemoryFileIndexTable {
  id: string;
  owner_user_id: string;
  source_kind: "vault" | "connector";
  source_path: string;
  file_hash: string;
  chunk_count: number;
  embed_model_name: string;
  embed_model_version: string;
  ingested_at: TimestampColumn;
}
```

Register it in the `JarvisDatabase` table map (next to the existing memory entries):

```ts
  "app.memory_chunks": MemoryChunksTable;
  "app.memory_links": MemoryLinksTable;
  "app.memory_file_index": MemoryFileIndexTable;
```

- [ ] **Step 4: Bump the stub to 768 and add provenance + role methods (keep `embed`)**

Edit `packages/memory/src/embedding-provider.ts`:

```ts
import { createHash } from "node:crypto";

export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly modelName: string;
  readonly modelVersion: string;
  /** Embed a document for indexing. The provider applies any required task prefix. */
  embedDocument(text: string): Promise<number[]>;
  /** Embed a search query. The provider applies any required task prefix. */
  embedQuery(text: string): Promise<number[]>;
}

export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 768;
  readonly modelName = "stub";
  readonly modelVersion = "0";

  async embedDocument(text: string): Promise<number[]> {
    return this.hashEmbed(text);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.hashEmbed(text);
  }

  /** Deprecated: retained until callers migrate in Task 5. */
  async embed(text: string): Promise<number[]> {
    return this.hashEmbed(text);
  }

  private hashEmbed(text: string): number[] {
    const hash = createHash("sha256").update(text).digest();
    return Array.from({ length: this.dimensions }, (_, i) => {
      const byte = hash[i % hash.length] ?? 0;
      return (byte / 255) * 2 - 1;
    });
  }
}
```

- [ ] **Step 5: Update the stub dimension test (write the failing assertion first)**

In `tests/integration/memory.test.ts`, the `StubEmbeddingProvider` describe block currently calls
`provider.embed(...)` and asserts `toHaveLength(provider.dimensions)`. Replace that block with:

```ts
describe("StubEmbeddingProvider", () => {
  it("returns a 768-dim vector for documents", async () => {
    const provider = new StubEmbeddingProvider();
    const vec = await provider.embedDocument("test text");
    expect(provider.dimensions).toBe(768);
    expect(vec).toHaveLength(768);
  });

  it("returns a 768-dim vector for queries", async () => {
    const provider = new StubEmbeddingProvider();
    const vec = await provider.embedQuery("test text");
    expect(vec).toHaveLength(768);
  });

  it("is deterministic for the same text", async () => {
    const provider = new StubEmbeddingProvider();
    const a = await provider.embedDocument("hello world");
    const b = await provider.embedDocument("hello world");
    expect(a).toEqual(b);
  });

  it("returns different vectors for different texts", async () => {
    const provider = new StubEmbeddingProvider();
    const a = await provider.embedDocument("apples");
    const b = await provider.embedDocument("quantum physics");
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 6: Run the migration + memory suite**

Run: `pnpm db:up && pnpm db:migrate`
Expected: migrations apply cleanly; `0031_memory_embedding_768.sql` listed as applied.

Run: `pnpm test:memory`
Expected: PASS. All existing ingest/retrieval tests still pass (they use the retained `embed()` via
the pipeline, which now produces 768-dim vectors matching the widened column).

- [ ] **Step 7: Full gate**

Run: `pnpm verify:foundation`
Expected: green (lint, format, file-size, typecheck, migrate, integration).

- [ ] **Step 8: Commit**

```bash
git add packages/memory/sql/0031_memory_embedding_768.sql packages/memory/src/manifest.ts \
        packages/db/src/types.ts packages/memory/src/embedding-provider.ts \
        tests/integration/memory.test.ts
git commit -m "feat(memory): widen embeddings to 768 dims, add provenance + file-index table"
```

---

## Task 3: Repository — file-index methods + provenance on chunk insert

**Files:**

- Modify: `packages/memory/src/repository.ts`
- Test: `tests/integration/memory.test.ts`

- [ ] **Step 1: Write failing tests for the file-index methods**

Add a new describe block in `tests/integration/memory.test.ts` (after the existing `MemoryRepository`
block). It uses the existing `repo`, `dataContext`, `ctx`, and `userId` helpers:

```ts
describe("MemoryRepository file index", () => {
  const repo = new MemoryRepository();

  it("upserts and reads back a file checkpoint", async () => {
    await dataContext.withDataContext(ctx(userId), async (scoped) => {
      await repo.upsertFileIndex(scoped, userId, "vault", "notes/a.md", "hash-1", 3, "stub", "0");
      const found = await repo.getFileIndex(scoped, userId, "vault", "notes/a.md");
      expect(found).toEqual({ fileHash: "hash-1", embedModelName: "stub" });
    });
  });

  it("overwrites the checkpoint on re-upsert (same path)", async () => {
    await dataContext.withDataContext(ctx(userId), async (scoped) => {
      await repo.upsertFileIndex(scoped, userId, "vault", "notes/b.md", "hash-1", 1, "stub", "0");
      await repo.upsertFileIndex(scoped, userId, "vault", "notes/b.md", "hash-2", 5, "stub", "0");
      const found = await repo.getFileIndex(scoped, userId, "vault", "notes/b.md");
      expect(found?.fileHash).toBe("hash-2");
    });
  });

  it("returns null for an unknown path", async () => {
    await dataContext.withDataContext(ctx(userId), async (scoped) => {
      const found = await repo.getFileIndex(scoped, userId, "vault", "notes/missing.md");
      expect(found).toBeNull();
    });
  });

  it("lists indexed paths for a user + source kind", async () => {
    await dataContext.withDataContext(ctx(userId), async (scoped) => {
      await repo.upsertFileIndex(scoped, userId, "vault", "notes/c.md", "h", 1, "stub", "0");
      const paths = await repo.listIndexedPaths(scoped, userId, "vault");
      expect(paths).toContain("notes/c.md");
    });
  });

  it("deletes a file checkpoint", async () => {
    await dataContext.withDataContext(ctx(userId), async (scoped) => {
      await repo.upsertFileIndex(scoped, userId, "vault", "notes/d.md", "h", 1, "stub", "0");
      await repo.deleteFileIndex(scoped, userId, "vault", "notes/d.md");
      const found = await repo.getFileIndex(scoped, userId, "vault", "notes/d.md");
      expect(found).toBeNull();
    });
  });
});
```

> Confirm the exact runner method name before running — the existing tests call
> `dataContext.withDataContext(...)`. If the codebase uses a different method (e.g. `.run(...)`),
> match the existing usage in this same test file.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:memory`
Expected: FAIL — `repo.upsertFileIndex is not a function`.

- [ ] **Step 3: Implement the repository methods**

Edit `packages/memory/src/repository.ts`. Update `upsertFileChunks` to accept and write provenance:

```ts
  async upsertFileChunks(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourcePath: string,
    chunks: readonly NewChunkData[],
    embedModelName: string,
    embedModelVersion: string
  ): Promise<void> {
    await this.deleteFileChunks(scopedDb, ownerUserId, sourcePath);

    for (const chunk of chunks) {
      const vectorLiteral = `[${chunk.embedding.join(",")}]`;
      await sql`
        INSERT INTO app.memory_chunks
          (owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text,
           embedding, embed_model_name, embed_model_version)
        VALUES
          (${ownerUserId}::uuid, ${"vault"}, ${chunk.sourcePath}, ${chunk.lineStart},
           ${chunk.lineEnd}, ${chunk.contentHash}, ${chunk.text}, ${vectorLiteral}::vector,
           ${embedModelName}, ${embedModelVersion})
      `.execute(scopedDb.db);
    }
  }
```

Add the file-index methods (anywhere in the class, e.g. after `replaceFileLinks`):

```ts
  async getFileIndex(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string,
    sourcePath: string
  ): Promise<{ fileHash: string; embedModelName: string } | null> {
    const result = await sql<{ file_hash: string; embed_model_name: string }>`
      SELECT file_hash, embed_model_name
      FROM app.memory_file_index
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND source_kind = ${sourceKind}
        AND source_path = ${sourcePath}
    `.execute(scopedDb.db);
    const row = result.rows[0];
    return row ? { fileHash: row.file_hash, embedModelName: row.embed_model_name } : null;
  }

  async upsertFileIndex(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string,
    sourcePath: string,
    fileHash: string,
    chunkCount: number,
    embedModelName: string,
    embedModelVersion: string
  ): Promise<void> {
    await sql`
      INSERT INTO app.memory_file_index
        (owner_user_id, source_kind, source_path, file_hash, chunk_count,
         embed_model_name, embed_model_version, ingested_at)
      VALUES
        (${ownerUserId}::uuid, ${sourceKind}, ${sourcePath}, ${fileHash}, ${chunkCount},
         ${embedModelName}, ${embedModelVersion}, now())
      ON CONFLICT (owner_user_id, source_kind, source_path) DO UPDATE SET
        file_hash = EXCLUDED.file_hash,
        chunk_count = EXCLUDED.chunk_count,
        embed_model_name = EXCLUDED.embed_model_name,
        embed_model_version = EXCLUDED.embed_model_version,
        ingested_at = now()
    `.execute(scopedDb.db);
  }

  async deleteFileIndex(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string,
    sourcePath: string
  ): Promise<void> {
    await sql`
      DELETE FROM app.memory_file_index
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND source_kind = ${sourceKind}
        AND source_path = ${sourcePath}
    `.execute(scopedDb.db);
  }

  async listIndexedPaths(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string
  ): Promise<string[]> {
    const result = await sql<{ source_path: string }>`
      SELECT source_path
      FROM app.memory_file_index
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND source_kind = ${sourceKind}
    `.execute(scopedDb.db);
    return result.rows.map((r) => r.source_path);
  }
```

- [ ] **Step 4: Update the one existing caller of `upsertFileChunks`**

`packages/memory/src/ingest.ts` calls `upsertFileChunks(scopedDb, userId, path, newChunks)`. Add the
two new args using the provider's provenance fields:

```ts
await this.repository.upsertFileChunks(
  scopedDb,
  vaultCtx.actorUserId,
  relativePath,
  newChunks,
  this.embeddingProvider.modelName,
  this.embeddingProvider.modelVersion
);
```

(The pipeline still uses `this.embeddingProvider.embed(...)` for now — that is migrated in Task 5.)

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test:memory`
Expected: PASS (new file-index tests + existing tests).

- [ ] **Step 6: Commit**

```bash
git add packages/memory/src/repository.ts packages/memory/src/ingest.ts \
        tests/integration/memory.test.ts
git commit -m "feat(memory): file-index repository methods + chunk provenance"
```

---

## Task 4: Idempotent + incremental ingestion + purge

**Files:**

- Modify: `packages/memory/src/ingest.ts`
- Test: `tests/integration/memory.test.ts`

- [ ] **Step 1: Write failing tests**

Add a describe block in `tests/integration/memory.test.ts`. It writes vault files via the existing
`vaultRunner` and `writeVaultFile`, and ingests via a `MemoryIngestPipeline` built with the stub:

```ts
describe("MemoryIngestPipeline idempotency", () => {
  const repo = new MemoryRepository();
  const pipeline = new MemoryIngestPipeline(new StubEmbeddingProvider(), repo);

  async function chunkCount(scoped: DataContextDb, path: string): Promise<number> {
    const r = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM app.memory_chunks
      WHERE owner_user_id = ${userId}::uuid AND source_path = ${path}
    `.execute(scoped.db);
    return Number(r.rows[0]?.n ?? "0");
  }

  it("skips re-ingest when the file is unchanged", async () => {
    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "loop/a.md", "## A\n\nfirst body");
      await dataContext.withDataContext(ctx(userId), async (scoped) => {
        const first = await pipeline.ingestFile(scoped, vaultCtx, "loop/a.md");
        expect(first.status).toBe("ingested");
        const second = await pipeline.ingestFile(scoped, vaultCtx, "loop/a.md");
        expect(second.status).toBe("skipped");
      });
    });
  });

  it("re-ingests when the file content changes", async () => {
    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "loop/b.md", "## B\n\noriginal");
      await dataContext.withDataContext(ctx(userId), async (scoped) => {
        await pipeline.ingestFile(scoped, vaultCtx, "loop/b.md");
        await writeVaultFile(vaultCtx, "loop/b.md", "## B\n\nchanged content");
        const again = await pipeline.ingestFile(scoped, vaultCtx, "loop/b.md");
        expect(again.status).toBe("ingested");
      });
    });
  });

  it("re-ingests when force is set even if unchanged", async () => {
    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "loop/c.md", "## C\n\nbody");
      await dataContext.withDataContext(ctx(userId), async (scoped) => {
        await pipeline.ingestFile(scoped, vaultCtx, "loop/c.md");
        const forced = await pipeline.ingestFile(scoped, vaultCtx, "loop/c.md", { force: true });
        expect(forced.status).toBe("ingested");
      });
    });
  });

  it("purges chunks + index entries for files removed from the vault", async () => {
    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "purge/keep.md", "## Keep\n\nstays");
      await writeVaultFile(vaultCtx, "purge/gone.md", "## Gone\n\nremoved later");
      await dataContext.withDataContext(ctx(userId), async (scoped) => {
        await pipeline.ingestFile(scoped, vaultCtx, "purge/keep.md");
        await pipeline.ingestFile(scoped, vaultCtx, "purge/gone.md");
        expect(await chunkCount(scoped, "purge/gone.md")).toBeGreaterThan(0);

        // Simulate deletion: remove the file from disk, then purge.
        await rm(join(vaultCtx.vaultRoot, "purge/gone.md"), { force: true });
        const result = await pipeline.purgeDeletedFiles(scoped, vaultCtx);
        expect(result.deleted).toBe(1);
        expect(await chunkCount(scoped, "purge/gone.md")).toBe(0);
        expect(await chunkCount(scoped, "purge/keep.md")).toBeGreaterThan(0);
        expect(await repo.getFileIndex(scoped, userId, "vault", "purge/gone.md")).toBeNull();
      });
    });
  });
});
```

Ensure `DataContextDb` is imported in the test file's type imports (it is used by `chunkCount`):
`import { ..., type DataContextDb } from "@jarv1s/db";`

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:memory`
Expected: FAIL — `ingestFile(...)` returns `void` (no `.status`); `purgeDeletedFiles` undefined.

- [ ] **Step 3: Implement idempotent ingestion**

Rewrite `packages/memory/src/ingest.ts`:

```ts
import { createHash } from "node:crypto";

import { listVaultFilesRecursive, readVaultFile } from "@jarv1s/vault";
import type { DataContextDb } from "@jarv1s/db";
import type { VaultContext } from "@jarv1s/vault";

import type { EmbeddingProvider } from "./embedding-provider.js";
import { parseDocument } from "./parser.js";
import type { MemoryRepository, NewChunkData } from "./repository.js";

const SOURCE_KIND = "vault";

export type IngestStatus = "ingested" | "skipped";

export interface IngestFileResult {
  readonly status: IngestStatus;
  readonly chunkCount: number;
}

export interface IngestFileOptions {
  readonly force?: boolean;
}

export class MemoryIngestPipeline {
  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly repository: MemoryRepository
  ) {}

  async ingestFile(
    scopedDb: DataContextDb,
    vaultCtx: VaultContext,
    relativePath: string,
    options: IngestFileOptions = {}
  ): Promise<IngestFileResult> {
    const content = await readVaultFile(vaultCtx, relativePath);
    const fileHash = createHash("sha256").update(content).digest("hex");
    const ownerUserId = vaultCtx.actorUserId;

    if (!options.force) {
      const existing = await this.repository.getFileIndex(
        scopedDb,
        ownerUserId,
        SOURCE_KIND,
        relativePath
      );
      if (
        existing &&
        existing.fileHash === fileHash &&
        existing.embedModelName === this.embeddingProvider.modelName
      ) {
        return { status: "skipped", chunkCount: 0 };
      }
    }

    const { chunks, wikilinks } = parseDocument(content);

    const newChunks: NewChunkData[] = await Promise.all(
      chunks.map(async (chunk) => ({
        sourcePath: relativePath,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        contentHash: createHash("sha256").update(chunk.text).digest("hex"),
        text: chunk.text,
        embedding: await this.embeddingProvider.embedDocument(chunk.text)
      }))
    );

    await this.repository.upsertFileChunks(
      scopedDb,
      ownerUserId,
      relativePath,
      newChunks,
      this.embeddingProvider.modelName,
      this.embeddingProvider.modelVersion
    );
    await this.repository.replaceFileLinks(scopedDb, ownerUserId, relativePath, wikilinks);
    await this.repository.upsertFileIndex(
      scopedDb,
      ownerUserId,
      SOURCE_KIND,
      relativePath,
      fileHash,
      newChunks.length,
      this.embeddingProvider.modelName,
      this.embeddingProvider.modelVersion
    );

    return { status: "ingested", chunkCount: newChunks.length };
  }

  async deleteFile(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourcePath: string
  ): Promise<void> {
    await this.repository.deleteFileChunks(scopedDb, ownerUserId, sourcePath);
    await this.repository.replaceFileLinks(scopedDb, ownerUserId, sourcePath, []);
    await this.repository.deleteFileIndex(scopedDb, ownerUserId, SOURCE_KIND, sourcePath);
  }

  async purgeDeletedFiles(
    scopedDb: DataContextDb,
    vaultCtx: VaultContext
  ): Promise<{ deleted: number }> {
    const ownerUserId = vaultCtx.actorUserId;
    const indexed = await this.repository.listIndexedPaths(scopedDb, ownerUserId, SOURCE_KIND);
    const present = new Set(
      (await listVaultFilesRecursive(vaultCtx)).filter((f) => f.endsWith(".md"))
    );

    let deleted = 0;
    for (const path of indexed) {
      if (!present.has(path)) {
        await this.deleteFile(scopedDb, ownerUserId, path);
        deleted += 1;
      }
    }
    return { deleted };
  }

  /** Disaster-recovery: wipe and re-ingest everything for this user. */
  async rebuildFromVault(scopedDb: DataContextDb, vaultCtx: VaultContext): Promise<void> {
    await this.repository.deleteAllForUser(scopedDb, vaultCtx.actorUserId);
    const allFiles = await listVaultFilesRecursive(vaultCtx);
    for (const file of allFiles) {
      if (file.endsWith(".md")) {
        await this.ingestFile(scopedDb, vaultCtx, file, { force: true });
      }
    }
  }
}
```

> `rebuildFromVault` calls `deleteAllForUser` (chunks + links). It does **not** clear
> `memory_file_index`; the subsequent `force: true` ingests overwrite each checkpoint via upsert.
> That is correct for a rebuild that re-touches every file. (Orphaned index rows for deleted files
> are handled by `purgeDeletedFiles`, which the IngestionService runs after the scan.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:memory`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/ingest.ts tests/integration/memory.test.ts
git commit -m "feat(memory): idempotent incremental ingest + purge of deleted files"
```

---

## Task 5: Interface cutover — retrieval uses `embedQuery`, remove `embed()`

**Files:**

- Modify: `packages/memory/src/retrieval.ts`
- Modify: `packages/memory/src/embedding-provider.ts`
- Test: `tests/integration/memory.test.ts` (existing retrieval test still passes)

- [ ] **Step 1: Switch retrieval to `embedQuery`**

Edit `packages/memory/src/retrieval.ts` — change the embed call:

```ts
  async retrieve(
    scopedDb: DataContextDb,
    query: string,
    limit: number = 10
  ): Promise<RetrievedChunk[]> {
    const queryEmbedding = await this.embeddingProvider.embedQuery(query);
    return this.repository.vectorSearch(scopedDb, queryEmbedding, limit);
  }
```

- [ ] **Step 2: Remove the deprecated `embed()` from the stub**

Edit `packages/memory/src/embedding-provider.ts` — delete the `embed(text)` method from
`StubEmbeddingProvider` (the interface never declared it). The class keeps `embedDocument`,
`embedQuery`, `hashEmbed`.

- [ ] **Step 3: Verify no remaining callers of `embed(`**

Run: `grep -rn "\.embed(" packages tests scripts --include=*.ts`
Expected: no matches (only `embedDocument` / `embedQuery` remain).

- [ ] **Step 4: Typecheck + memory suite**

Run: `pnpm typecheck && pnpm test:memory`
Expected: PASS. (The existing "retriever returns the ingested chunk" test now exercises `embedQuery`
against documents embedded with `embedDocument` — both are the stub's `hashEmbed`, so an exact-text
query still ranks its own chunk first.)

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/retrieval.ts packages/memory/src/embedding-provider.ts
git commit -m "refactor(memory): retrieval uses embedQuery; drop deprecated embed()"
```

---

## Task 6: LocalEmbeddingProvider + config factory

**Files:**

- Create: `packages/memory/src/local-embedding-provider.ts`
- Create: `packages/memory/src/embedding-provider-config.ts`
- Modify: `packages/memory/src/index.ts`

This task has no fast unit test (loading the model downloads ~274 MB and is covered by the slow
test in Task 9). Verification here is typecheck + a guarded smoke check.

- [ ] **Step 1: Implement `LocalEmbeddingProvider`**

Create `packages/memory/src/local-embedding-provider.ts`:

```ts
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

import type { EmbeddingProvider } from "./embedding-provider.js";

const DEFAULT_MODEL_ID = "nomic-ai/nomic-embed-text-v1.5";

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 768;
  readonly modelName: string;
  readonly modelVersion = "1.5";

  private pipe: FeatureExtractionPipeline | null = null;

  constructor(modelId: string = DEFAULT_MODEL_ID) {
    this.modelName = modelId;
  }

  async embedDocument(text: string): Promise<number[]> {
    return this.run("search_document", text);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.run("search_query", text);
  }

  private async getPipe(): Promise<FeatureExtractionPipeline> {
    if (!this.pipe) {
      this.pipe = (await pipeline(
        "feature-extraction",
        this.modelName
      )) as FeatureExtractionPipeline;
    }
    return this.pipe;
  }

  private async run(prefix: "search_document" | "search_query", text: string): Promise<number[]> {
    const pipe = await this.getPipe();
    const output = await pipe(`${prefix}: ${text}`, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }
}
```

> If `FeatureExtractionPipeline` is not exported by the installed `@huggingface/transformers` version,
> fall back to `private pipe: Awaited<ReturnType<typeof pipeline>> | null = null;` and drop the `as`
> casts. Confirm by checking `node_modules/@huggingface/transformers/types/` during implementation.

- [ ] **Step 2: Implement the config + factory**

Create `packages/memory/src/embedding-provider-config.ts`:

```ts
import type { EmbeddingProvider } from "./embedding-provider.js";
import { StubEmbeddingProvider } from "./embedding-provider.js";
import { LocalEmbeddingProvider } from "./local-embedding-provider.js";

export type EmbeddingProviderKind = "local" | "stub";

export interface EmbeddingProviderConfig {
  readonly kind: EmbeddingProviderKind;
  readonly modelId?: string;
}

/** The only place that instantiates an embedding provider. Never hardcode a provider elsewhere. */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.kind) {
    case "local":
      return new LocalEmbeddingProvider(config.modelId);
    case "stub":
      return new StubEmbeddingProvider();
  }
}

/**
 * Read instance-level embedding config from the environment.
 * M-A3 replaces this with a DB-backed reader feeding the capability router; the
 * EmbeddingProviderConfig shape and createEmbeddingProvider factory stay stable.
 */
export function getEmbeddingProviderConfig(): EmbeddingProviderConfig {
  const kind = (process.env["JARVIS_EMBED_PROVIDER"] ?? "local") as EmbeddingProviderKind;
  const modelId = process.env["JARVIS_EMBED_MODEL"];
  return modelId ? { kind, modelId } : { kind };
}
```

- [ ] **Step 3: Export from the package index**

Edit `packages/memory/src/index.ts` to add:

```ts
export { LocalEmbeddingProvider } from "./local-embedding-provider.js";
export type {
  EmbeddingProviderConfig,
  EmbeddingProviderKind
} from "./embedding-provider-config.js";
export {
  createEmbeddingProvider,
  getEmbeddingProviderConfig
} from "./embedding-provider-config.js";
export type { IngestFileOptions, IngestFileResult, IngestStatus } from "./ingest.js";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/local-embedding-provider.ts \
        packages/memory/src/embedding-provider-config.ts packages/memory/src/index.ts
git commit -m "feat(memory): LocalEmbeddingProvider + config factory (nomic-embed-text-v1.5)"
```

---

## Task 7: IngestionService

**Files:**

- Create: `packages/memory/src/ingestion-service.ts`
- Modify: `packages/memory/src/index.ts`
- Test: `tests/integration/memory.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/integration/memory.test.ts`:

```ts
describe("IngestionService", () => {
  const repo = new MemoryRepository();
  const pipeline = new MemoryIngestPipeline(new StubEmbeddingProvider(), repo);
  const service = new IngestionService(pipeline, repo, dataContext);

  it("ingests all markdown files and reports stats", async () => {
    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "svc/one.md", "## One\n\nalpha");
      await writeVaultFile(vaultCtx, "svc/two.md", "## Two\n\nbeta");
      const stats = await service.ingestVault(ctx(userId), vaultCtx);
      expect(stats.processed).toBe(2);
      expect(stats.skipped).toBe(0);
      expect(stats.failed).toHaveLength(0);
    });
  });

  it("skips unchanged files on a second run", async () => {
    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "svc2/a.md", "## A\n\nbody");
      await service.ingestVault(ctx(userId), vaultCtx);
      const second = await service.ingestVault(ctx(userId), vaultCtx);
      expect(second.processed).toBe(0);
      expect(second.skipped).toBeGreaterThanOrEqual(1);
    });
  });

  it("purges files removed from the vault and counts them", async () => {
    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "svc3/keep.md", "## Keep\n\nx");
      await writeVaultFile(vaultCtx, "svc3/drop.md", "## Drop\n\ny");
      await service.ingestVault(ctx(userId), vaultCtx);
      await rm(join(vaultCtx.vaultRoot, "svc3/drop.md"), { force: true });
      const stats = await service.ingestVault(ctx(userId), vaultCtx);
      expect(stats.deleted).toBe(1);
    });
  });
});
```

Add `IngestionService` to the `@jarv1s/memory` import in the test file's import block.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:memory`
Expected: FAIL — `IngestionService is not exported`.

- [ ] **Step 3: Implement the service**

Create `packages/memory/src/ingestion-service.ts`:

```ts
import { listVaultFilesRecursive } from "@jarv1s/vault";
import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import type { VaultContext } from "@jarv1s/vault";

import type { MemoryIngestPipeline } from "./ingest.js";
import type { MemoryRepository } from "./repository.js";

export interface IngestOptions {
  readonly force?: boolean;
  readonly sourcePath?: string;
}

export interface IngestFailure {
  readonly path: string;
  readonly error: string;
}

export interface IngestStats {
  processed: number;
  skipped: number;
  deleted: number;
  failed: IngestFailure[];
}

export class IngestionService {
  constructor(
    private readonly pipeline: MemoryIngestPipeline,
    private readonly repository: MemoryRepository,
    private readonly dataContextRunner: DataContextRunner
  ) {}

  async ingestVault(
    accessCtx: AccessContext,
    vaultCtx: VaultContext,
    options: IngestOptions = {}
  ): Promise<IngestStats> {
    const stats: IngestStats = { processed: 0, skipped: 0, deleted: 0, failed: [] };

    const allFiles = (await listVaultFilesRecursive(vaultCtx)).filter((f) => f.endsWith(".md"));
    const targets = options.sourcePath
      ? allFiles.filter((f) => f === options.sourcePath)
      : allFiles;

    // One transaction PER FILE so a SQL failure on one file does not poison the rest.
    // (withDataContext wraps its callback in a single Postgres transaction; a failed
    //  statement aborts that whole transaction, so we must not share it across files.)
    for (const path of targets) {
      try {
        const result = await this.dataContextRunner.withDataContext(accessCtx, (scoped) =>
          this.pipeline.ingestFile(scoped, vaultCtx, path, { force: options.force ?? false })
        );
        if (result.status === "ingested") stats.processed += 1;
        else stats.skipped += 1;
      } catch (err) {
        stats.failed.push({ path, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Purge runs in its own transaction, and only on a full-vault run (a single-file
    // ingest must not delete the rest of the index).
    if (!options.sourcePath) {
      const purge = await this.dataContextRunner.withDataContext(accessCtx, (scoped) =>
        this.pipeline.purgeDeletedFiles(scoped, vaultCtx)
      );
      stats.deleted = purge.deleted;
    }

    return stats;
  }
}
```

> `DataContextRunner.withDataContext(accessCtx, work)` runs `work` inside one `rootDb.transaction()`
> (verified in `packages/db/src/data-context.ts`). That is why each file gets its own
> `withDataContext` call above — per-file transaction = real error isolation.

- [ ] **Step 4: Export the service**

Edit `packages/memory/src/index.ts`:

```ts
export { IngestionService } from "./ingestion-service.js";
export type { IngestOptions, IngestStats, IngestFailure } from "./ingestion-service.js";
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test:memory`
Expected: PASS.

- [ ] **Step 6: Full gate**

Run: `pnpm verify:foundation`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/memory/src/ingestion-service.ts packages/memory/src/index.ts \
        tests/integration/memory.test.ts
git commit -m "feat(memory): IngestionService with stats + error isolation + purge"
```

---

## Task 8: CLI entry point

**Files:**

- Create: `scripts/ingest-vault.ts`
- Modify: `package.json` (root)

- [ ] **Step 1: Write the CLI**

Create `scripts/ingest-vault.ts`. Mirror the construction patterns from existing `scripts/*.ts`
(e.g. `scripts/migrate.ts`) for DB URL handling — confirm whether they read `process.env.DATABASE_URL`
directly or via a `@jarv1s/db` helper, and match that.

```ts
import { randomUUID } from "node:crypto";

import { createDatabase, DataContextRunner, type AccessContext } from "@jarv1s/db";
import { VaultContextRunner } from "@jarv1s/vault";
import {
  IngestionService,
  MemoryIngestPipeline,
  MemoryRepository,
  createEmbeddingProvider,
  getEmbeddingProviderConfig
} from "@jarv1s/memory";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const connectionString = requireEnv("DATABASE_URL");
  const actorUserId = requireEnv("JARVIS_USER_ID");
  const vaultBaseDir = requireEnv("JARVIS_VAULT_ROOT");

  const provider = createEmbeddingProvider(getEmbeddingProviderConfig());
  console.log(`Embedding provider: ${provider.modelName} (${provider.dimensions} dims)`);

  const repository = new MemoryRepository();
  const pipeline = new MemoryIngestPipeline(provider, repository);
  const db = createDatabase({ connectionString, maxConnections: 1 });
  const dataContextRunner = new DataContextRunner(db);
  const service = new IngestionService(pipeline, repository, dataContextRunner);

  const accessCtx: AccessContext = { actorUserId, requestId: `ingest-cli:${randomUUID()}` };
  const vaultRunner = new VaultContextRunner(vaultBaseDir);

  try {
    const stats = await vaultRunner.withVaultContext(accessCtx, (vaultCtx) =>
      service.ingestVault(accessCtx, vaultCtx, { force })
    );

    console.log("Ingestion complete:");
    console.log(`  processed: ${stats.processed}`);
    console.log(`  skipped:   ${stats.skipped}`);
    console.log(`  deleted:   ${stats.deleted}`);
    console.log(`  failed:    ${stats.failed.length}`);
    for (const f of stats.failed) console.error(`    ! ${f.path}: ${f.error}`);

    process.exitCode = stats.failed.length > 0 ? 1 : 0;
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

> `createDatabase` and `DataContextRunner` are imported from `@jarv1s/db` exactly as the integration
> tests do. If `createDatabase`'s option shape differs (check `packages/db/src/index.ts`), match the
> test usage: `createDatabase({ connectionString, maxConnections: 1 })`.

- [ ] **Step 2: Add the root scripts**

Edit the root `package.json` `scripts` block — add:

```json
    "ingest:vault": "tsx scripts/ingest-vault.ts",
    "test:memory:local": "vitest run tests/slow/memory-local-embed.test.ts",
```

- [ ] **Step 3: Smoke-test the CLI against a throwaway vault**

```bash
pnpm db:up && pnpm db:migrate
# Find/create a real user id from the DB; seed a vault file for it under JARVIS_VAULT_ROOT/<uuid>/.
# Example (adjust the UUID to a real app.users.id row):
export JARVIS_VAULT_ROOT=/tmp/jarv1s-cli-vault
export JARVIS_USER_ID=<a-real-user-uuid>
export JARVIS_EMBED_PROVIDER=stub   # avoid the 274MB download for the smoke test
mkdir -p "$JARVIS_VAULT_ROOT/$JARVIS_USER_ID"
printf '## Smoke\n\nhello from the cli\n' > "$JARVIS_VAULT_ROOT/$JARVIS_USER_ID/smoke.md"
DATABASE_URL="$(node -e "console.log(require('@jarv1s/db').getJarvisDatabaseUrls().app)")" pnpm ingest:vault
```

Expected: prints `Embedding provider: stub (768 dims)` then `processed: 1 / skipped: 0 / deleted: 0 /
failed: 0`. A second run prints `processed: 0 / skipped: 1`.

> If wiring `DATABASE_URL` from the helper is awkward in your shell, set it to the same app connection
> string the integration tests use. The point of this step is to prove the CLI runs end-to-end and is
> idempotent. Record the actual output in the task review.

- [ ] **Step 4: Lint/format/typecheck**

Run: `pnpm lint && pnpm format:check && pnpm typecheck`
Expected: PASS. (Run `pnpm format` first if needed.)

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-vault.ts package.json
git commit -m "feat(memory): ingest:vault CLI as thin IngestionService caller"
```

---

## Task 9: Real-embedding end-to-end test (slow path)

**Files:**

- Create: `tests/slow/memory-local-embed.test.ts`

This test downloads the model (~274 MB) on first run, so it lives in `tests/slow/` and is **not**
matched by `pnpm test:integration` (`vitest run tests/integration`) or `verify:foundation`. It is run
explicitly via `pnpm test:memory:local` (script added in Task 8).

- [ ] **Step 1: Write the slow test**

Create `tests/slow/memory-local-embed.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import type { Kysely } from "kysely";
import { VaultContextRunner, writeVaultFile } from "@jarv1s/vault";
import {
  IngestionService,
  LocalEmbeddingProvider,
  MemoryIngestPipeline,
  MemoryRepository,
  MemoryRetriever
} from "@jarv1s/memory";
import { connectionStrings, resetEmptyFoundationDatabase } from "../integration/test-database.js";

const { Client } = pg;
const TIMEOUT = 300_000; // model download + inference on first run

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const vaultBase = join(tmpdir(), `jarv1s-local-embed-${randomUUID()}`);
const vaultRunner = new VaultContextRunner(vaultBase);
const userId = "00000000-0000-4000-8000-0000000000a1";
function ctx(actorUserId: string): AccessContext {
  return { actorUserId, requestId: "req:local-embed-test" };
}

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.users (id, email, is_instance_admin) VALUES ($1, 'local-embed@example.test', false)`,
      [userId]
    );
  } finally {
    await client.end();
  }
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  dataContext = new DataContextRunner(appDb);
}, TIMEOUT);

afterAll(async () => {
  await appDb.destroy();
  await rm(vaultBase, { recursive: true, force: true });
});

describe("LocalEmbeddingProvider", () => {
  it(
    "produces 768-dim vectors with sensible cosine geometry",
    async () => {
      const provider = new LocalEmbeddingProvider();
      const cat = await provider.embedDocument("The cat sat on the warm windowsill.");
      const kitten = await provider.embedDocument("A kitten napped in the sunny window.");
      const finance = await provider.embedDocument("Quarterly interest rates affect bond yields.");

      expect(cat).toHaveLength(768);
      expect(cosine(cat, kitten)).toBeGreaterThan(0.5);
      expect(cosine(cat, finance)).toBeLessThan(0.3);
    },
    TIMEOUT
  );

  it(
    "ranks the on-topic note first in end-to-end semantic search",
    async () => {
      const provider = new LocalEmbeddingProvider();
      const repo = new MemoryRepository();
      const pipeline = new MemoryIngestPipeline(provider, repo);
      const retriever = new MemoryRetriever(provider, repo);
      const service = new IngestionService(pipeline, repo, dataContext);

      await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
        await writeVaultFile(
          vaultCtx,
          "topics/gardening.md",
          "## Gardening\n\nCompost improves soil and helps tomatoes thrive in raised beds."
        );
        await writeVaultFile(
          vaultCtx,
          "topics/astronomy.md",
          "## Astronomy\n\nThe telescope resolved the rings of Saturn against the night sky."
        );
        await writeVaultFile(
          vaultCtx,
          "topics/cooking.md",
          "## Cooking\n\nSearing the steak in a hot cast-iron pan builds a deep crust."
        );

        const stats = await service.ingestVault(ctx(userId), vaultCtx);
        expect(stats.processed).toBe(3);

        const hits = await dataContext.withDataContext(ctx(userId), (scoped) =>
          retriever.retrieve(scoped, "how do I grow vegetables in my backyard?", 3)
        );
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0]?.sourcePath).toBe("topics/gardening.md");
        expect(hits[0]?.similarity).toBeGreaterThan(0.5);
      });
    },
    TIMEOUT
  );

  it(
    "is idempotent: a second ingest run re-embeds nothing",
    async () => {
      const provider = new LocalEmbeddingProvider();
      const repo = new MemoryRepository();
      const pipeline = new MemoryIngestPipeline(provider, repo);
      const service = new IngestionService(pipeline, repo, dataContext);

      await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
        await writeVaultFile(vaultCtx, "idem/note.md", "## Note\n\nstable content for idempotency");
        const first = await service.ingestVault(ctx(userId), vaultCtx);
        expect(first.processed).toBeGreaterThanOrEqual(1);
        const second = await service.ingestVault(ctx(userId), vaultCtx);
        expect(second.processed).toBe(0);
        expect(second.skipped).toBeGreaterThanOrEqual(1);
      });
    },
    TIMEOUT
  );
});
```

> The end-to-end test reuses files from the gardening/astronomy/cooking ingest plus the idempotency
> note; because `ingestVault` runs `purgeDeletedFiles`, keep each test's writes additive within the
> shared vault, or scope assertions to specific paths (as done above).

- [ ] **Step 2: Run the slow test**

Run: `pnpm db:up && pnpm db:migrate && pnpm test:memory:local`
Expected: first run downloads the model, then PASS — gardening note ranks first with similarity > 0.5;
related-text cosine > 0.5; unrelated < 0.3; second ingest reports `processed: 0`.

- [ ] **Step 3: Confirm it stays out of the fast gate**

Run: `pnpm test:integration`
Expected: the `tests/slow/` file is **not** collected (no model download during `verify:foundation`).

- [ ] **Step 4: Commit**

```bash
git add tests/slow/memory-local-embed.test.ts
git commit -m "test(memory): real nomic-embed-text-v1.5 end-to-end semantic search (slow path)"
```

---

## Task 10: Final verification + docs + milestone bookkeeping

**Files:**

- Modify: `docs/STATUS.md`

- [ ] **Step 1: Full foundation gate**

Run: `pnpm verify:foundation`
Expected: green — lint, format:check, check:file-size, typecheck, db:migrate, test:integration.

- [ ] **Step 2: Release-hardening audit**

Run: `pnpm audit:release-hardening`
Expected: `passed true; failures []`. (Confirms the new `memory_file_index` table has correct RLS
and no role gained `BYPASSRLS`.)

- [ ] **Step 3: Slow path once more (clean confirmation)**

Run: `pnpm test:memory:local`
Expected: PASS (model now cached; faster).

- [ ] **Step 4: File-size check spot review**

Run: `pnpm check:file-size`
Expected: PASS. Confirm `ingest.ts`, `ingestion-service.ts`, and `repository.ts` are each well under
1000 lines. If any approaches the limit, extract helpers before closing the milestone.

- [ ] **Step 5: Update STATUS.md**

Edit `docs/STATUS.md`:

- "Last known-good state" → bump to **30 migrations applied** and the new integration test count
  (record the actual number `pnpm test:integration` reports).
- "Next step" → `M-A2 · Surface the substrate (REST + UI)` once M-A1 exit criteria are checked off.

- [ ] **Step 6: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: M-A1 complete — real embeddings + live vault ingestion green"
```

- [ ] **Step 7: GitHub bookkeeping (manual, per CLAUDE.md milestone-end checklist)**

- Check off all exit-criteria boxes on epic issue #2, then close it.
- Close the M-A1 GitHub Milestone.
- Set ROADMAP.md M-A1 status to "Complete".
- Save a durable agentmemory lesson for any non-obvious decision (e.g. the stub-768 correction,
  the `vector(384)→vector(768)` drop-index-then-truncate migration sequence).

---

## Exit Criteria (from the spec — all must hold)

1. `pnpm verify:foundation` green.
2. `pnpm audit:release-hardening` green.
3. `pnpm test:memory` green (existing + idempotency/purge/service tests on the stub).
4. `pnpm test:memory:local` passes — gardening note ranks first, similarity > 0.5.
5. `pnpm db:migrate` applies `0031_memory_embedding_768.sql` cleanly on a fresh DB.
6. `pnpm ingest:vault` runs to completion and reports meaningful stats.
7. Second `pnpm ingest:vault` on an unchanged vault reports `processed: 0`.
8. Epic issue #2 closed; ROADMAP + STATUS updated.

## Hard Invariants Honored

- `memory_file_index` ships with `ENABLE`/`FORCE ROW LEVEL SECURITY` + owner-only policies **before**
  any `GRANT` (Task 2 migration).
- Repositories accept only `DataContextDb`; the CLI mints scope via `DataContextRunner`.
- All vault I/O flows through `VaultContext` / `@jarv1s/vault`; the CLI's only filesystem touch is the
  smoke-test fixture, not production code.
- `AccessContext` stays `{ actorUserId, requestId }` — the CLI and service construct exactly that.
- No secrets in logs/payloads — the CLI logs model name, dims, and counts only.
- `0031` is a **new** migration file; `0030` is never edited.
- Provider selection is config-driven via `createEmbeddingProvider` / `getEmbeddingProviderConfig` —
  no hardcoded provider outside the factory (M-A3 router seam).
