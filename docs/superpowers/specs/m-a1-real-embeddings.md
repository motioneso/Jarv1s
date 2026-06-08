# M-A1: Real Embeddings + Live Vault Ingestion

**Status:** Approved — locked decisions, build-ready  
**Date:** 2026-06-07  
**Owner:** Ben  
**GitHub:** Epic issue #2 · Milestone M-A1

---

## Context

The memory foundation from Slices 2–4 is complete and green:

- `@jarv1s/vault` — VaultContext, VaultContextRunner, vault-ops (read/write/list/exists)
- `@jarv1s/memory` — EmbeddingProvider interface, StubEmbeddingProvider, MemoryRepository,
  MemoryIngestPipeline, MemoryRetriever, MemoryParser
- DB: `app.memory_chunks` (`vector(384)`, HNSW index), `app.memory_links`
- Known-good: 29 migrations applied, 177 integration tests pass, `pnpm verify:foundation` green

What M-A1 must add:

- A real embedding model — `StubEmbeddingProvider` produces hash-based noise vectors with no
  semantic content
- Idempotent / incremental ingestion — `rebuildFromVault` currently deletes everything and
  re-embeds on every run
- Model provenance tracking — no record of which model embedded which chunk
- A reusable `IngestionService` — ingestion logic is buried in the pipeline with no external
  entry point
- A thin CLI entry point to trigger ingestion

---

## Goals

1. Replace `StubEmbeddingProvider` with `LocalEmbeddingProvider` (`nomic-embed-text-v1.5`,
   in-process via `@huggingface/transformers`)
2. Migrate schema: `vector(384)` → `vector(768)` + add provenance columns
3. Add `app.memory_file_index` table for idempotent / incremental ingestion
4. Wrap ingestion in a reusable `IngestionService` (source-agnostic; vault is the first kind)
5. Add a thin CLI script as the first caller of `IngestionService`
6. Introduce an instance-level `EmbeddingProviderConfig` + factory, shaped to fold into the
   M-A3 capability router without a breaking interface change
7. Validate end-to-end: real vault → real embeddings → real semantic search hits

---

## Non-Goals (deferred to later specs)

- Per-user embedding provider selection → M-A3 (capability router)
- Connector → memory ingestion → M-B1
- REST endpoints or UI for vault search → M-A2
- Background / worker-driven ingestion scheduling → M-A2
- Model fine-tuning or ONNX quantization selection
- Real AI provider chat calls → M-A3
- Curation, briefings, feeds → M-A4

---

## Resolved Decisions

All decisions below were locked in the M-A1 brief. **Build agents must not re-open them.**

| #   | Decision                 | Choice                                                                   | Why                                                                                              |
| --- | ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 1   | Embedding model          | `nomic-embed-text-v1.5` via `nomic-ai/nomic-embed-text-v1.5`             | Best 2026 quality for vault-scale retrieval; open weights; strong semantic fidelity at 768 dims  |
| 2   | Runtime                  | In-process via `@huggingface/transformers` (ONNX) — NOT Ollama, NOT HTTP | No external services; zero-setup for self-hosters; `pnpm install` and it works                   |
| 3   | Dimensions               | 768                                                                      | Native output of nomic-embed-text-v1.5                                                           |
| 4   | Context window           | 8192 tokens                                                              | Handles long H2 note sections without truncation                                                 |
| 5   | Provider selection scope | Instance-level (one model per Jarvis install for now)                    | Simplest approach that is privacy-correct and folds cleanly into the M-A3 router later           |
| 6   | Task prefixes            | `"search_document: "` for ingest; `"search_query: "` for retrieval       | Required by nomic-embed-text-v1.5 for optimal embedding quality; must be baked into the provider |
| 7   | Idempotency granularity  | File-level SHA-256 hash                                                  | Simplest correct approach; chunk-level is over-engineering for this milestone                    |
| 8   | Ingestion entry point    | `IngestionService` class + thin CLI caller                               | Seam #1 — M-A2 worker and M-B1 connectors will call the same service, not re-implement it        |

---

## Architecture

### Piece 1: EmbeddingProvider Interface Changes

**File:** `packages/memory/src/embedding-provider.ts` _(modify)_

The current single `embed(text)` method does not distinguish ingest-time vs query-time roles,
which is required by nomic-embed-text-v1.5 (and by most modern bi-encoder models). The
interface gains role-specific methods and provenance fields.

```ts
export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly modelName: string; // e.g. "nomic-ai/nomic-embed-text-v1.5"
  readonly modelVersion: string; // e.g. "1.5"
  /** For indexing documents. Provider adds any required task prefix. */
  embedDocument(text: string): Promise<number[]>;
  /** For embedding search queries. Provider adds any required task prefix. */
  embedQuery(text: string): Promise<number[]>;
}
```

`StubEmbeddingProvider` updated:

```ts
export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384; // kept at 384 — tests don't run migration
  readonly modelName = "stub";
  readonly modelVersion = "0";

  async embedDocument(text: string): Promise<number[]> {
    return this.hashEmbed(text);
  }
  async embedQuery(text: string): Promise<number[]> {
    return this.hashEmbed(text);
  }

  private hashEmbed(text: string): number[] {
    /* existing SHA-256 logic */
  }
}
```

**Breaking change note:** The `embed(text)` method is removed. All callers (currently only
`MemoryIngestPipeline` and `MemoryRetriever`) must migrate to `embedDocument` / `embedQuery`.
No external consumers exist yet.

---

### Piece 2: LocalEmbeddingProvider

**File:** `packages/memory/src/local-embedding-provider.ts` _(create)_

```ts
import { pipeline } from "@huggingface/transformers";

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 768;
  readonly modelName: string;
  readonly modelVersion = "1.5";

  private _pipe: Awaited<ReturnType<typeof pipeline>> | null = null;

  constructor(modelId = "nomic-ai/nomic-embed-text-v1.5") {
    this.modelName = modelId;
  }

  private async getPipe() {
    if (!this._pipe) {
      this._pipe = await pipeline("feature-extraction", this.modelName);
    }
    return this._pipe;
  }

  async embedDocument(text: string): Promise<number[]> {
    return this.run("search_document", text);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.run("search_query", text);
  }

  private async run(prefix: string, text: string): Promise<number[]> {
    const pipe = await this.getPipe();
    const out = await pipe(`${prefix}: ${text}`, { pooling: "mean", normalize: true });
    return Array.from(out.data as Float32Array);
  }
}
```

Model auto-downloads (~274 MB) to the HuggingFace cache on first call. Subsequent calls use
the cached ONNX weights. No external service required.

---

### Piece 3: EmbeddingProviderConfig + Factory

**File:** `packages/memory/src/embedding-provider-config.ts` _(create)_

```ts
export type EmbeddingProviderKind = "local" | "stub";

export interface EmbeddingProviderConfig {
  kind: EmbeddingProviderKind;
  modelId?: string; // for 'local'; defaults to 'nomic-ai/nomic-embed-text-v1.5'
}

/** Factory — the only place that instantiates a provider. Never hardcode elsewhere. */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.kind) {
    case "local":
      return new LocalEmbeddingProvider(config.modelId);
    case "stub":
      return new StubEmbeddingProvider();
  }
}

/** Read instance config from environment. M-A3 will replace this with a DB-backed reader. */
export function getEmbeddingProviderConfig(): EmbeddingProviderConfig {
  const kind = (process.env["JARVIS_EMBED_PROVIDER"] ?? "local") as EmbeddingProviderKind;
  const modelId = process.env["JARVIS_EMBED_MODEL"];
  return { kind, ...(modelId ? { modelId } : {}) };
}
```

Env vars:

| Var                     | Default                      | Purpose                                                       |
| ----------------------- | ---------------------------- | ------------------------------------------------------------- |
| `JARVIS_EMBED_PROVIDER` | `local`                      | Provider kind; `stub` for tests that must skip model download |
| `JARVIS_EMBED_MODEL`    | _(unset → provider default)_ | Override model ID for `local` provider                        |

**M-A3 seam:** The `EmbeddingProviderConfig` shape and `createEmbeddingProvider` factory are
stable. M-A3 replaces only `getEmbeddingProviderConfig()` with a DB-backed config reader; no
other code changes.

---

### Piece 4: Schema Migration

**File:** `packages/memory/sql/0031_memory_embedding_768.sql` _(create)_

`memory_chunks.embedding` must change from `vector(384)` to `vector(768)`. pgvector requires
dropping the HNSW index before altering the column. Since `memory_chunks` is derived /
rebuildable, it is safe to truncate and re-ingest.

```sql
-- Drop HNSW index first (required by pgvector before altering vector dimension)
DROP INDEX IF EXISTS memory_chunks_embedding_idx;

-- Truncate derived data (safe — fully rebuilt by ingestion)
TRUNCATE TABLE app.memory_chunks;
TRUNCATE TABLE app.memory_links;

-- Widen the embedding column to 768 dims
ALTER TABLE app.memory_chunks
  ALTER COLUMN embedding TYPE vector(768);

-- Add model provenance columns (nullable — rows from before this migration are gone)
ALTER TABLE app.memory_chunks
  ADD COLUMN IF NOT EXISTS embed_model_name    text,
  ADD COLUMN IF NOT EXISTS embed_model_version text;

-- Recreate HNSW index for 768-dim cosine search
CREATE INDEX memory_chunks_embedding_idx
  ON app.memory_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- File-level ingestion checkpoint table (idempotency + provenance)
CREATE TABLE IF NOT EXISTS app.memory_file_index (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    uuid        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  source_kind      text        NOT NULL CHECK (source_kind IN ('vault', 'connector')),
  source_path      text        NOT NULL,
  file_hash        text        NOT NULL,
  chunk_count      integer     NOT NULL DEFAULT 0,
  embed_model_name text        NOT NULL,
  embed_model_version text     NOT NULL,
  ingested_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, source_kind, source_path)
);

ALTER TABLE app.memory_file_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_file_index FORCE ROW LEVEL SECURITY;

CREATE POLICY memory_file_index_select ON app.memory_file_index
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

CREATE POLICY memory_file_index_insert ON app.memory_file_index
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY memory_file_index_update ON app.memory_file_index
  FOR UPDATE TO jarvis_app_runtime
  USING  (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY memory_file_index_delete ON app.memory_file_index
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_file_index TO jarvis_app_runtime;
```

**Manifest update:** `packages/memory/src/manifest.ts` — append `'sql/0031_memory_embedding_768.sql'`
to `database.migrations` and add `'app.memory_file_index'` to `database.ownedTables`.

---

### Piece 5: Kysely Type Extension

**File:** `packages/db/src/types.ts` _(modify)_

Update `MemoryChunksTable` to add the new provenance columns:

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
  embedding: string | null;
  embed_model_name: string | null; // NEW
  embed_model_version: string | null; // NEW
  updated_at: TimestampColumn;
}
```

Add new table interface:

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

Register in `JarvisDatabase`:

```ts
"app.memory_file_index": MemoryFileIndexTable;
```

---

### Piece 6: MemoryRepository Changes

**File:** `packages/memory/src/repository.ts` _(modify)_

Add two new methods:

```ts
// Look up file checkpoint (idempotency check)
async getFileIndex(
  scopedDb: DataContextDb,
  ownerUserId: string,
  sourceKind: string,
  sourcePath: string
): Promise<{ fileHash: string; embedModelName: string } | null>

// Upsert file checkpoint after successful ingest
async upsertFileIndex(
  scopedDb: DataContextDb,
  ownerUserId: string,
  sourceKind: string,
  sourcePath: string,
  fileHash: string,
  chunkCount: number,
  embedModelName: string,
  embedModelVersion: string
): Promise<void>

// Delete file checkpoint (on file delete)
async deleteFileIndex(
  scopedDb: DataContextDb,
  ownerUserId: string,
  sourceKind: string,
  sourcePath: string
): Promise<void>

// List all indexed paths for a user + source_kind (for purge logic)
async listIndexedPaths(
  scopedDb: DataContextDb,
  ownerUserId: string,
  sourceKind: string
): Promise<string[]>
```

Also update `upsertFileChunks` signature to accept `embedModelName: string` and
`embedModelVersion: string`, writing them to the new columns.

---

### Piece 7: MemoryIngestPipeline Changes

**File:** `packages/memory/src/ingest.ts` _(modify)_

`ingestFile` becomes idempotent:

```
ingestFile(scopedDb, vaultCtx, relativePath, options?: { force?: boolean })

1. Read file content from vault
2. Compute SHA-256 of the full file content → file_hash
3. Fetch existing checkpoint via repository.getFileIndex(...)
4. If checkpoint.fileHash === file_hash AND checkpoint.embedModelName === provider.modelName
   AND NOT options.force → return early (skipped)
5. Parse document into chunks
6. Embed each chunk via provider.embedDocument(chunk.text)
7. repository.upsertFileChunks(..., embedModelName, embedModelVersion)
8. repository.replaceFileLinks(...)
9. repository.upsertFileIndex(..., file_hash, chunks.length, ...)
```

`deleteFile` also calls `repository.deleteFileIndex(...)`.

New method `purgeDeletedFiles`:

```
purgeDeletedFiles(scopedDb, vaultCtx): Promise<{ deleted: number }>

1. indexedPaths = repository.listIndexedPaths(..., source_kind='vault')
2. vaultPaths = listVaultFilesRecursive(vaultCtx) filtered to .md
3. for each path in indexedPaths that is NOT in vaultPaths:
     deleteFile(scopedDb, ownerUserId, path)
4. return { deleted: count }
```

`rebuildFromVault` retains its current semantics (full wipe + re-ingest) for disaster-recovery
use but is no longer called by the CLI or IngestionService. IngestionService uses the
incremental path.

**Retrieval change:** `MemoryRetriever.retrieve` calls `provider.embedQuery(query)` instead
of the removed `provider.embed(query)`.

---

### Piece 8: IngestionService

**File:** `packages/memory/src/ingestion-service.ts` _(create)_

```ts
export interface IngestOptions {
  force?: boolean; // bypass hash check, re-embed every file
  sourcePath?: string; // ingest only one specific file (for event-driven later)
}

export interface IngestStats {
  processed: number;
  skipped: number;
  deleted: number;
  failed: { path: string; error: string }[];
  durationMs: number;
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
    options?: IngestOptions
  ): Promise<IngestStats>;
}
```

`ingestVault` implementation:

1. List all `.md` files in vault
2. If `options.sourcePath` is set, process only that file
3. For each file, run `pipeline.ingestFile(...)` inside `dataContextRunner.run(accessCtx, ...)`
4. Collect skipped / processed / failed per file
5. Call `pipeline.purgeDeletedFiles(...)` to clean up removed files
6. Return `IngestStats`

Error isolation: a failure on one file is recorded in `failed[]` and the loop continues.

**Why `IngestionService` is separate from `MemoryIngestPipeline`:** The pipeline handles
single-file operations (parse → embed → store). The service owns the vault scan loop,
DataContextRunner lifecycle, error collection, and stats. This keeps each class focused and
makes the service callable from CLI, worker job, and future connector paths without coupling.

---

### Piece 9: CLI Script

**File:** `scripts/ingest-vault.ts` _(create)_

A thin Node.js script. Not a daemon — runs once and exits.

Reads from environment:

| Env var                 | Required             | Purpose                               |
| ----------------------- | -------------------- | ------------------------------------- |
| `DATABASE_URL`          | Yes                  | Postgres connection string            |
| `JARVIS_USER_ID`        | Yes                  | UUID of the user to ingest for        |
| `JARVIS_VAULT_ROOT`     | Yes                  | Absolute path to vault root directory |
| `JARVIS_EMBED_PROVIDER` | No (default `local`) | Provider kind                         |
| `JARVIS_EMBED_MODEL`    | No                   | Override model ID                     |

Logic:

```
1. Build provider from getEmbeddingProviderConfig()
2. Create MemoryRepository, MemoryIngestPipeline, IngestionService
3. Create Kysely DB from DATABASE_URL
4. Build AccessContext { actorUserId: JARVIS_USER_ID, requestId: randomUUID() }
5. Build VaultContext from JARVIS_VAULT_ROOT + actorUserId
6. Call service.ingestVault(accessCtx, vaultCtx, { force: --force flag if set })
7. Print stats table; exit 0 on success, 1 if any failures
```

Add a `scripts` entry in the root `package.json`:

```json
"ingest:vault": "tsx scripts/ingest-vault.ts"
```

---

## Five Required Seams — Compliance Checklist

Every build agent must verify all five before declaring a slice done.

| #   | Seam                                                                                  | Satisfied by                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ingestion is a reusable **service**, not a throwaway script                           | `IngestionService` in `@jarv1s/memory`; CLI is a thin `tsx` caller; M-A2 worker will call the same service                                                                                                                 |
| 2   | Embed/chunk/store core is **source-agnostic** — vault is just the first `source_kind` | `source_kind` column already exists; `IngestionService.ingestVault` pairs `sourceKind='vault'` with the vault scan; a future `ingestConnector` caller pairs `'connector'`; no vault-specific logic leaks into the pipeline |
| 3   | Provider config is shaped to **fold into M-A3 capability router**                     | `EmbeddingProviderConfig` type + `createEmbeddingProvider` factory are stable; M-A3 replaces only `getEmbeddingProviderConfig()`                                                                                           |
| 4   | **Idempotent + incremental** by `content_hash`                                        | `memory_file_index` stores `file_hash`; `ingestFile` skips unchanged files; second run on unchanged vault shows 0 processed, N skipped                                                                                     |
| 5   | Index records **model provenance**                                                    | `embed_model_name` + `embed_model_version` on both `memory_chunks` and `memory_file_index`; a future provider swap can detect which files need re-embedding                                                                |

---

## Files Created / Modified

| Action | File                                                | Purpose                                                                                                                                 |
| ------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Modify | `packages/memory/src/embedding-provider.ts`         | Add `modelName`, `modelVersion`, `embedDocument`, `embedQuery`; update `StubEmbeddingProvider`                                          |
| Create | `packages/memory/src/local-embedding-provider.ts`   | `LocalEmbeddingProvider` (nomic-embed-text-v1.5 via @huggingface/transformers)                                                          |
| Create | `packages/memory/src/embedding-provider-config.ts`  | `EmbeddingProviderConfig` type, `createEmbeddingProvider` factory, `getEmbeddingProviderConfig` env reader                              |
| Modify | `packages/memory/src/repository.ts`                 | Add `getFileIndex`, `upsertFileIndex`, `deleteFileIndex`, `listIndexedPaths`; update `upsertFileChunks` signature                       |
| Modify | `packages/memory/src/ingest.ts`                     | Idempotent `ingestFile`; add `purgeDeletedFiles`; keep `rebuildFromVault` for disaster recovery                                         |
| Modify | `packages/memory/src/retrieval.ts`                  | Use `embedQuery` instead of removed `embed`                                                                                             |
| Create | `packages/memory/src/ingestion-service.ts`          | `IngestionService` class                                                                                                                |
| Modify | `packages/memory/src/index.ts`                      | Export `LocalEmbeddingProvider`, `IngestionService`, `EmbeddingProviderConfig`, `createEmbeddingProvider`, `getEmbeddingProviderConfig` |
| Create | `packages/memory/sql/0031_memory_embedding_768.sql` | Schema migration: vector(768), provenance columns, memory_file_index table                                                              |
| Modify | `packages/memory/src/manifest.ts`                   | Register new migration + ownedTable                                                                                                     |
| Modify | `packages/db/src/types.ts`                          | Update `MemoryChunksTable`; add `MemoryFileIndexTable`; register in `JarvisDatabase`                                                    |
| Create | `scripts/ingest-vault.ts`                           | CLI entry point                                                                                                                         |
| Modify | `package.json` (root)                               | Add `"ingest:vault"` script                                                                                                             |
| Modify | `tests/integration/memory.test.ts`                  | Update to `embedDocument`/`embedQuery`; add idempotency + purge tests                                                                   |
| Create | `tests/integration/memory-local-embed.test.ts`      | End-to-end real-embedding test (requires model download; excluded from default fast path)                                               |

---

## Integration Test Coverage

### Keep (fast path — no model download)

All existing `tests/integration/memory.test.ts` tests continue using `StubEmbeddingProvider`.
Add to the same file:

- `ingestFile` skips unchanged file when `file_hash` matches existing index record
- `ingestFile` re-embeds when file content changes (hash mismatch)
- `ingestFile` re-embeds when `embed_model_name` changes (provider swap detection)
- `purgeDeletedFiles` removes chunks and index entries for files deleted from vault
- `IngestionService.ingestVault` with stub provider: returns correct `processed` / `skipped` /
  `deleted` counts across multiple calls

### New (slow path — downloads ~274 MB on first run)

**File:** `tests/integration/memory-local-embed.test.ts`

- `LocalEmbeddingProvider.embedDocument` returns a `number[]` of length 768
- `LocalEmbeddingProvider.embedQuery` returns a `number[]` of length 768
- Cosine similarity between two semantically related texts > 0.5
- Cosine similarity between unrelated texts < 0.3
- End-to-end: ingest 3 markdown files with distinct topics → query one topic → correct file
  ranks first with similarity > 0.7
- Idempotency: run `IngestionService.ingestVault` twice on the same vault → second run reports
  0 processed, N skipped
- Provider-mismatch: force-set a different `embed_model_name` in the index → next run
  re-embeds (processed = N)

Run this test file explicitly:

```sh
vitest run tests/integration/memory-local-embed.test.ts
```

It is excluded from `pnpm test:memory` (the default fast path). CI may run it on a separate
job with a large timeout.

---

## Exit Criteria

All must be true before M-A1 is closed:

1. `pnpm verify:foundation` green — lint, format:check, check:file-size, typecheck,
   db:migrate, test:integration all pass; no file exceeds 1000 lines
2. `pnpm audit:release-hardening` green
3. `pnpm test:memory` green — all existing tests plus new idempotency/purge tests using
   `StubEmbeddingProvider`
4. `vitest run tests/integration/memory-local-embed.test.ts` passes — semantic search
   returns a relevant hit with similarity > 0.7 on a test vault
5. `pnpm db:migrate` applies `0031_memory_embedding_768.sql` cleanly on a fresh database
6. `pnpm ingest:vault` runs to completion against a test vault without errors, reporting
   meaningful stats
7. Second run of `pnpm ingest:vault` on the same unchanged vault reports 0 processed / N
   skipped (idempotency confirmed)
8. GitHub: epic issue #2 has all task sub-issues closed; status moved to "Done"

---

## Hard Invariants (from CLAUDE.md — must hold throughout)

- No `BYPASSRLS`. New table `app.memory_file_index` must have `ENABLE ROW LEVEL SECURITY`
  - `FORCE ROW LEVEL SECURITY` + owner-only policies before any `GRANT`.
- `DataContextDb` only — repositories accept only the branded handle, never raw Kysely.
- `VaultContext` for all vault I/O — `IngestionService` and pipeline accept `VaultContext`,
  never raw `fs` calls.
- `AccessContext` shape is `{ actorUserId, requestId }` only — do not add fields.
- Secrets never in logs or job payloads — model file paths and vault paths are acceptable;
  embedding vectors are acceptable.
- Never edit applied migrations — `0031_memory_embedding_768.sql` must be a new file, not an
  edit to `0030_memory_index.sql`.
- No file >1000 lines — if `ingestion-service.ts` or `ingest.ts` approach the limit, split
  (e.g. extract helpers).
