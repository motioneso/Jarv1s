import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import pg from "pg";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type DataContextDb,
  type JarvisDatabase
} from "@jarv1s/db";
import { VaultContextRunner, writeVaultFile } from "@jarv1s/vault";
import {
  IngestionService,
  MemoryIngestPipeline,
  MemoryRepository,
  MemoryRetriever,
  StubEmbeddingProvider,
  parseDocument
} from "@jarv1s/memory";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// ── parseDocument ─────────────────────────────────────────────────────────────

describe("parseDocument", () => {
  it("extracts frontmatter text and excludes it from body chunks", () => {
    const content = `---
name: Alice
role: designer
---
## About

Alice works on product.`;
    const doc = parseDocument(content);
    expect(doc.frontmatterText).toContain("name: Alice");
    const bodyChunk = doc.chunks.find((c) => c.text.includes("Alice works on product."));
    expect(bodyChunk).toBeDefined();
    expect(doc.chunks.every((c) => !c.text.startsWith("---"))).toBe(true);
  });

  it("extracts [[wikilinks]] from body", () => {
    const content = `# Note\n\nSee also [[Alice]] and [[Bob|Robert]].`;
    const doc = parseDocument(content);
    expect(doc.wikilinks.sort()).toEqual(["Alice", "Bob"].sort());
  });

  it("chunks document by H2 headings", () => {
    const content = `# Doc\n\n## Section A\n\nText A.\n\n## Section B\n\nText B.`;
    const doc = parseDocument(content);
    const chunkTexts = doc.chunks.map((c) => c.text);
    expect(chunkTexts.some((t) => t.includes("Text A."))).toBe(true);
    expect(chunkTexts.some((t) => t.includes("Text B."))).toBe(true);
  });

  it("treats document with no headings as a single chunk", () => {
    const content = `Just a plain note with no headings.`;
    const doc = parseDocument(content);
    expect(doc.chunks).toHaveLength(1);
    expect(doc.chunks[0]?.text).toContain("Just a plain note");
  });

  it("returns empty chunks and no wikilinks for empty document", () => {
    const doc = parseDocument("");
    expect(doc.chunks).toHaveLength(0);
    expect(doc.wikilinks).toHaveLength(0);
  });
});

// ── StubEmbeddingProvider ─────────────────────────────────────────────────────

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

// ── shared DB + vault setup for remaining tests ───────────────────────────────

const vaultBase = join(tmpdir(), `jarv1s-memory-test-${randomUUID()}`);
const vaultRunner = new VaultContextRunner(vaultBase);
const userId = "00000000-0000-4000-8000-000000000011";
const otherUserId = "00000000-0000-4000-8000-000000000012";

function ctx(actorUserId: string): AccessContext {
  return { actorUserId, requestId: "req:memory-test" };
}

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.users (id, email, is_instance_admin)
       VALUES ($1, 'memory-a@example.test', false),
              ($2, 'memory-b@example.test', false)`,
      [userId, otherUserId]
    );
  } finally {
    await client.end();
  }
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  dataContext = new DataContextRunner(appDb);
});

afterAll(async () => {
  await appDb.destroy();
  await rm(vaultBase, { recursive: true, force: true });
});

// ── MemoryRepository, MemoryIngestPipeline, MemoryRetriever tests follow below ──
// (added in Tasks 5–7)

// ── MemoryRepository ──────────────────────────────────────────────────────────

describe("MemoryRepository", () => {
  const repo = new MemoryRepository();
  const provider = new StubEmbeddingProvider();

  async function makeChunks(
    sourcePath: string,
    texts: string[]
  ): Promise<
    Array<{
      sourcePath: string;
      lineStart: number;
      lineEnd: number;
      contentHash: string;
      text: string;
      embedding: number[];
    }>
  > {
    return Promise.all(
      texts.map(async (text, i) => ({
        sourcePath,
        lineStart: i * 10,
        lineEnd: i * 10 + 5,
        contentHash: Buffer.from(text).toString("hex"),
        text,
        embedding: await provider.embedDocument(text)
      }))
    );
  }

  it("upsertFileChunks inserts chunks visible to the owner", async () => {
    const path = "notes/repo-test-1.md";
    const chunks = await makeChunks(path, ["Chunk one text", "Chunk two text"]);
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.upsertFileChunks(scopedDb, userId, path, chunks, "stub", "0");
      const stored = await sql<{ text: string }>`
        SELECT text FROM app.memory_chunks
        WHERE source_path = ${path}
        ORDER BY line_start
      `.execute(scopedDb.db);
      expect(stored.rows.map((r) => r.text)).toEqual(["Chunk one text", "Chunk two text"]);
    });
  });

  it("upsertFileChunks replaces all existing chunks for the path", async () => {
    const path = "notes/repo-test-2.md";
    const firstChunks = await makeChunks(path, ["Old content"]);
    const newChunks = await makeChunks(path, ["New content A", "New content B"]);

    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.upsertFileChunks(scopedDb, userId, path, firstChunks, "stub", "0");
      await repo.upsertFileChunks(scopedDb, userId, path, newChunks, "stub", "0");
      const stored = await sql<{ text: string }>`
        SELECT text FROM app.memory_chunks WHERE source_path = ${path} ORDER BY line_start
      `.execute(scopedDb.db);
      expect(stored.rows.map((r) => r.text)).toEqual(["New content A", "New content B"]);
    });
  });

  it("vectorSearch returns chunks ranked by similarity (owner-scoped)", async () => {
    const path = "notes/repo-test-3.md";
    const chunks = await makeChunks(path, ["The quick brown fox"]);
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.upsertFileChunks(scopedDb, userId, path, chunks, "stub", "0");
    });

    const queryVec = await provider.embedQuery("The quick brown fox");
    const results = await dataContext.withDataContext(ctx(userId), async (scopedDb) =>
      repo.vectorSearch(scopedDb, queryVec, 10)
    );
    expect(results.some((r) => r.sourcePath === path)).toBe(true);

    // Other user sees no results
    const otherResults = await dataContext.withDataContext(ctx(otherUserId), async (scopedDb) =>
      repo.vectorSearch(scopedDb, queryVec, 10)
    );
    expect(otherResults.every((r) => r.sourcePath !== path)).toBe(true);
  });

  it("deleteFileChunks removes all chunks for a path", async () => {
    const path = "notes/repo-test-4.md";
    const chunks = await makeChunks(path, ["To be deleted"]);
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.upsertFileChunks(scopedDb, userId, path, chunks, "stub", "0");
      await repo.deleteFileChunks(scopedDb, userId, path);
      const stored = await sql<{ id: string }>`
        SELECT id FROM app.memory_chunks WHERE source_path = ${path}
      `.execute(scopedDb.db);
      expect(stored.rows).toHaveLength(0);
    });
  });

  it("deleteAllForUser removes all chunks for the user", async () => {
    const path = "notes/repo-test-5.md";
    const chunks = await makeChunks(path, ["User data"]);
    // Use a fresh user so we don't interfere with other tests
    const freshUserId = "00000000-0000-4000-8000-000000000013";
    const freshClient = new Client({ connectionString: connectionStrings.bootstrap });
    await freshClient.connect();
    try {
      await freshClient.query(
        `INSERT INTO app.users (id, email, is_instance_admin) VALUES ($1, 'memory-fresh@example.test', false)`,
        [freshUserId]
      );
    } finally {
      await freshClient.end();
    }

    await dataContext.withDataContext(ctx(freshUserId), async (scopedDb) => {
      await repo.upsertFileChunks(scopedDb, freshUserId, path, chunks, "stub", "0");
      await repo.deleteAllForUser(scopedDb, freshUserId);
      const stored = await sql<{ id: string }>`
        SELECT id FROM app.memory_chunks WHERE owner_user_id = ${freshUserId}::uuid
      `.execute(scopedDb.db);
      expect(stored.rows).toHaveLength(0);
    });
  });

  it("replaceFileLinks upserts wikilinks for a path", async () => {
    const fromPath = "notes/repo-links.md";
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.replaceFileLinks(scopedDb, userId, fromPath, ["Alice", "Bob"]);
      const stored = await sql<{ to_path: string }>`
        SELECT to_path FROM app.memory_links WHERE from_path = ${fromPath} ORDER BY to_path
      `.execute(scopedDb.db);
      expect(stored.rows.map((r) => r.to_path)).toEqual(["Alice", "Bob"].sort());

      // Replacing with a new set removes old links
      await repo.replaceFileLinks(scopedDb, userId, fromPath, ["Charlie"]);
      const updated = await sql<{ to_path: string }>`
        SELECT to_path FROM app.memory_links WHERE from_path = ${fromPath}
      `.execute(scopedDb.db);
      expect(updated.rows.map((r) => r.to_path)).toEqual(["Charlie"]);
    });
  });
});

// ── MemoryIngestPipeline ──────────────────────────────────────────────────────

describe("MemoryIngestPipeline", () => {
  const repo = new MemoryRepository();
  const provider = new StubEmbeddingProvider();
  const pipeline = new MemoryIngestPipeline(provider, repo);

  it("ingestFile produces memory_chunks for each parsed chunk", async () => {
    const filePath = "notes/ingest-test-1.md";
    const content = `## Overview\n\nThis is the overview.\n\n## Details\n\nThis is the details section.`;

    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, filePath, content);
      await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
        await pipeline.ingestFile(scopedDb, vaultCtx, filePath);
        const result = await sql<{ count: string }>`
          SELECT count(*)::text FROM app.memory_chunks
          WHERE owner_user_id = ${userId}::uuid AND source_path = ${filePath}
        `.execute(scopedDb.db);
        expect(Number(result.rows[0]?.count)).toBeGreaterThan(0);
      });
    });
  });

  it("ingestFile stores wikilinks in memory_links", async () => {
    const filePath = "notes/ingest-links.md";
    const content = `# Link Test\n\nSee [[Alice]] and [[Bob]].`;

    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, filePath, content);
      await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
        await pipeline.ingestFile(scopedDb, vaultCtx, filePath);
        const result = await sql<{ to_path: string }>`
          SELECT to_path FROM app.memory_links
          WHERE owner_user_id = ${userId}::uuid AND from_path = ${filePath}
          ORDER BY to_path
        `.execute(scopedDb.db);
        expect(result.rows.map((r) => r.to_path)).toEqual(["Alice", "Bob"]);
      });
    });
  });

  it("re-ingesting an edited file replaces old chunks with new ones", async () => {
    const filePath = "notes/ingest-edit.md";
    const original = `## Original\n\nOriginal content.`;
    const revised = `## Revised\n\nRevised content.`;

    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, filePath, original);
      await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
        await pipeline.ingestFile(scopedDb, vaultCtx, filePath);
      });

      await writeVaultFile(vaultCtx, filePath, revised);
      await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
        await pipeline.ingestFile(scopedDb, vaultCtx, filePath);
        const result = await sql<{ text: string }>`
          SELECT text FROM app.memory_chunks
          WHERE owner_user_id = ${userId}::uuid AND source_path = ${filePath}
        `.execute(scopedDb.db);
        expect(result.rows.some((r) => r.text.includes("Revised content."))).toBe(true);
        expect(result.rows.every((r) => !r.text.includes("Original content."))).toBe(true);
      });
    });
  });

  it("deleteFile removes all chunks and links for the path", async () => {
    const filePath = "notes/ingest-delete.md";
    const content = `# Delete Test\n\nSome content with [[Link]].`;

    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, filePath, content);
      await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
        await pipeline.ingestFile(scopedDb, vaultCtx, filePath);
        await pipeline.deleteFile(scopedDb, userId, filePath);
        const chunks = await sql<{ id: string }>`
          SELECT id FROM app.memory_chunks
          WHERE owner_user_id = ${userId}::uuid AND source_path = ${filePath}
        `.execute(scopedDb.db);
        const links = await sql<{ id: string }>`
          SELECT id FROM app.memory_links
          WHERE owner_user_id = ${userId}::uuid AND from_path = ${filePath}
        `.execute(scopedDb.db);
        expect(chunks.rows).toHaveLength(0);
        expect(links.rows).toHaveLength(0);
      });
    });
  });

  it("rebuildFromVault clears old index and re-indexes all .md files in the vault", async () => {
    // Use a separate user so we don't pollute other tests
    const rebuildUserId = "00000000-0000-4000-8000-000000000014";
    const rebuildClient = new Client({ connectionString: connectionStrings.bootstrap });
    await rebuildClient.connect();
    try {
      await rebuildClient.query(
        `INSERT INTO app.users (id, email, is_instance_admin) VALUES ($1, 'memory-rebuild@example.test', false)`,
        [rebuildUserId]
      );
    } finally {
      await rebuildClient.end();
    }

    await vaultRunner.withVaultContext(ctx(rebuildUserId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "notes/file-a.md", `## A\n\nContent A.`);
      await writeVaultFile(vaultCtx, "notes/file-b.md", `## B\n\nContent B.`);
      await writeVaultFile(vaultCtx, "notes/ignored.txt", "not markdown");

      await dataContext.withDataContext(ctx(rebuildUserId), async (scopedDb) => {
        await pipeline.rebuildFromVault(scopedDb, vaultCtx);
        const result = await sql<{ source_path: string }>`
          SELECT DISTINCT source_path FROM app.memory_chunks
          WHERE owner_user_id = ${rebuildUserId}::uuid
          ORDER BY source_path
        `.execute(scopedDb.db);
        const paths = result.rows.map((r) => r.source_path);
        expect(paths).toContain("notes/file-a.md");
        expect(paths).toContain("notes/file-b.md");
        expect(paths).not.toContain("notes/ignored.txt");
      });
    });
  });
});

// ── MemoryRepository file index ───────────────────────────────────────────────

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

// ── MemoryIngestPipeline idempotency ─────────────────────────────────────────

describe("MemoryIngestPipeline idempotency", () => {
  // Use a dedicated user so this describe's file-index state is fully isolated
  // from the MemoryRepository file-index tests (which insert index rows without
  // corresponding disk files, causing purgeDeletedFiles to over-count).
  const idemUserId = "00000000-0000-4000-8000-000000000016";
  const repo = new MemoryRepository();
  const pipeline = new MemoryIngestPipeline(new StubEmbeddingProvider(), repo);

  beforeAll(async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO app.users (id, email, is_instance_admin)
         VALUES ($1, 'memory-idem@example.test', false)`,
        [idemUserId]
      );
    } finally {
      await client.end();
    }
  });

  it("skips re-ingest when the file is unchanged", async () => {
    await vaultRunner.withVaultContext(ctx(idemUserId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "loop/a.md", "## A\n\nfirst body");
      await dataContext.withDataContext(ctx(idemUserId), async (scoped) => {
        const first = await pipeline.ingestFile(scoped, vaultCtx, "loop/a.md");
        expect(first.status).toBe("ingested");
        const second = await pipeline.ingestFile(scoped, vaultCtx, "loop/a.md");
        expect(second.status).toBe("skipped");
      });
    });
  });

  it("re-ingests when the file content changes", async () => {
    await vaultRunner.withVaultContext(ctx(idemUserId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "loop/b.md", "## B\n\noriginal");
      await dataContext.withDataContext(ctx(idemUserId), async (scoped) => {
        await pipeline.ingestFile(scoped, vaultCtx, "loop/b.md");
        await writeVaultFile(vaultCtx, "loop/b.md", "## B\n\nchanged content");
        const again = await pipeline.ingestFile(scoped, vaultCtx, "loop/b.md");
        expect(again.status).toBe("ingested");
      });
    });
  });

  it("re-ingests when force is set even if unchanged", async () => {
    await vaultRunner.withVaultContext(ctx(idemUserId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "loop/c.md", "## C\n\nbody");
      await dataContext.withDataContext(ctx(idemUserId), async (scoped) => {
        await pipeline.ingestFile(scoped, vaultCtx, "loop/c.md");
        const forced = await pipeline.ingestFile(scoped, vaultCtx, "loop/c.md", { force: true });
        expect(forced.status).toBe("ingested");
      });
    });
  });

  it("purges chunks + index entries for files removed from the vault", async () => {
    // Use a fresh sub-user for this test so prior idempotency tests'
    // index entries (loop/a.md, loop/b.md, loop/c.md) don't affect the count.
    const purgeUserId = "00000000-0000-4000-8000-000000000017";
    const purgeClient = new Client({ connectionString: connectionStrings.bootstrap });
    await purgeClient.connect();
    try {
      await purgeClient.query(
        `INSERT INTO app.users (id, email, is_instance_admin)
         VALUES ($1, 'memory-purge@example.test', false)`,
        [purgeUserId]
      );
    } finally {
      await purgeClient.end();
    }

    async function purgeChunkCount(scoped: DataContextDb, path: string): Promise<number> {
      const r = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM app.memory_chunks
        WHERE owner_user_id = ${purgeUserId}::uuid AND source_path = ${path}
      `.execute(scoped.db);
      return Number(r.rows[0]?.n ?? "0");
    }

    await vaultRunner.withVaultContext(ctx(purgeUserId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "purge/keep.md", "## Keep\n\nstays");
      await writeVaultFile(vaultCtx, "purge/gone.md", "## Gone\n\nremoved later");
      await dataContext.withDataContext(ctx(purgeUserId), async (scoped) => {
        await pipeline.ingestFile(scoped, vaultCtx, "purge/keep.md");
        await pipeline.ingestFile(scoped, vaultCtx, "purge/gone.md");
        expect(await purgeChunkCount(scoped, "purge/gone.md")).toBeGreaterThan(0);

        // Simulate deletion: remove the file from disk, then purge.
        await rm(join(vaultCtx.vaultRoot, "purge/gone.md"), { force: true });
        const result = await pipeline.purgeDeletedFiles(scoped, vaultCtx);
        expect(result.deleted).toBe(1);
        expect(await purgeChunkCount(scoped, "purge/gone.md")).toBe(0);
        expect(await purgeChunkCount(scoped, "purge/keep.md")).toBeGreaterThan(0);
        expect(await repo.getFileIndex(scoped, purgeUserId, "vault", "purge/gone.md")).toBeNull();
      });
    });
  });
});

// ── MemoryRetriever ───────────────────────────────────────────────────────────

describe("MemoryRetriever", () => {
  const repo = new MemoryRepository();
  const provider = new StubEmbeddingProvider();
  const pipeline = new MemoryIngestPipeline(provider, repo);
  const retriever = new MemoryRetriever(provider, repo);

  // Use a dedicated user so these tests don't collide with earlier seeded data
  const retrieverUserId = "00000000-0000-4000-8000-000000000015";

  beforeAll(async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO app.users (id, email, is_instance_admin)
         VALUES ($1, 'memory-retriever@example.test', false)`,
        [retrieverUserId]
      );
    } finally {
      await client.end();
    }

    // Seed two files so retrieval has something to find
    await vaultRunner.withVaultContext(ctx(retrieverUserId), async (vaultCtx) => {
      await writeVaultFile(
        vaultCtx,
        "knowledge/alpha.md",
        `## Alpha\n\nAlpha is the first letter.`
      );
      await writeVaultFile(vaultCtx, "knowledge/beta.md", `## Beta\n\nBeta is the second letter.`);
      await dataContext.withDataContext(ctx(retrieverUserId), async (scopedDb) => {
        await pipeline.ingestFile(scopedDb, vaultCtx, "knowledge/alpha.md");
        await pipeline.ingestFile(scopedDb, vaultCtx, "knowledge/beta.md");
      });
    });
  });

  it("retrieve returns chunks with provenance (sourcePath, lineStart, lineEnd)", async () => {
    const results = await dataContext.withDataContext(ctx(retrieverUserId), async (scopedDb) =>
      retriever.retrieve(scopedDb, "the first letter", 10)
    );
    expect(results.length).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toMatchObject({
      sourcePath: expect.any(String),
      lineStart: expect.any(Number),
      lineEnd: expect.any(Number),
      text: expect.any(String),
      similarity: expect.any(Number)
    });
    expect(first?.sourcePath).toMatch(/knowledge\/(alpha|beta)\.md/);
  });

  it("retrieve is owner-scoped: other user sees no results from this user's vault", async () => {
    const results = await dataContext.withDataContext(ctx(otherUserId), async (scopedDb) =>
      retriever.retrieve(scopedDb, "the first letter", 10)
    );
    // otherUserId has no ingested data, so no results from retrieverUserId's vault
    expect(
      results.every(
        (r) => r.sourcePath !== "knowledge/alpha.md" && r.sourcePath !== "knowledge/beta.md"
      )
    ).toBe(true);
  });
});

// ── IngestionService ─────────────────────────────────────────────────────────

describe("IngestionService", () => {
  // Use a dedicated user so the service's full-vault scans are isolated
  const svcUserId = "00000000-0000-4000-8000-000000000018";
  const repo = new MemoryRepository();
  const pipeline = new MemoryIngestPipeline(new StubEmbeddingProvider(), repo);
  // dataContext is initialized in the outer beforeAll — create the service lazily
  let service: IngestionService;

  beforeAll(async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO app.users (id, email, is_instance_admin)
         VALUES ($1, 'memory-svc@example.test', false)`,
        [svcUserId]
      );
    } finally {
      await client.end();
    }
    service = new IngestionService(pipeline, repo, dataContext);
  });

  it("ingests all markdown files and reports stats", async () => {
    await vaultRunner.withVaultContext(ctx(svcUserId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "svc/one.md", "## One\n\nalpha");
      await writeVaultFile(vaultCtx, "svc/two.md", "## Two\n\nbeta");
      const stats = await service.ingestVault(ctx(svcUserId), vaultCtx);
      expect(stats.processed).toBe(2);
      expect(stats.skipped).toBe(0);
      expect(stats.failed).toHaveLength(0);
    });
  });

  it("skips unchanged files on a second run", async () => {
    await vaultRunner.withVaultContext(ctx(svcUserId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "svc2/a.md", "## A\n\nbody");
      await service.ingestVault(ctx(svcUserId), vaultCtx);
      const second = await service.ingestVault(ctx(svcUserId), vaultCtx);
      expect(second.processed).toBe(0);
      expect(second.skipped).toBeGreaterThanOrEqual(1);
    });
  });

  it("purges files removed from the vault and counts them", async () => {
    await vaultRunner.withVaultContext(ctx(svcUserId), async (vaultCtx) => {
      await writeVaultFile(vaultCtx, "svc3/keep.md", "## Keep\n\nx");
      await writeVaultFile(vaultCtx, "svc3/drop.md", "## Drop\n\ny");
      await service.ingestVault(ctx(svcUserId), vaultCtx);
      await rm(join(vaultCtx.vaultRoot, "svc3/drop.md"), { force: true });
      const stats = await service.ingestVault(ctx(svcUserId), vaultCtx);
      expect(stats.deleted).toBe(1);
    });
  });
});
