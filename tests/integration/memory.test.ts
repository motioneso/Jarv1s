import { createHash, randomUUID } from "node:crypto";
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
  type JarvisDatabase
} from "@jarv1s/db";
import { VaultContextRunner, writeVaultFile } from "@jarv1s/vault";
import { MemoryRepository, StubEmbeddingProvider, parseDocument } from "@jarv1s/memory";
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
  it("returns a vector of the declared dimensions", async () => {
    const provider = new StubEmbeddingProvider();
    const vec = await provider.embed("test text");
    expect(vec).toHaveLength(provider.dimensions);
  });

  it("returns the same vector for the same text (deterministic)", async () => {
    const provider = new StubEmbeddingProvider();
    const a = await provider.embed("hello world");
    const b = await provider.embed("hello world");
    expect(a).toEqual(b);
  });

  it("returns different vectors for different texts", async () => {
    const provider = new StubEmbeddingProvider();
    const a = await provider.embed("apples");
    const b = await provider.embed("quantum physics");
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
        embedding: await provider.embed(text)
      }))
    );
  }

  it("upsertFileChunks inserts chunks visible to the owner", async () => {
    const path = "notes/repo-test-1.md";
    const chunks = await makeChunks(path, ["Chunk one text", "Chunk two text"]);
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.upsertFileChunks(scopedDb, userId, path, chunks);
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
      await repo.upsertFileChunks(scopedDb, userId, path, firstChunks);
      await repo.upsertFileChunks(scopedDb, userId, path, newChunks);
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
      await repo.upsertFileChunks(scopedDb, userId, path, chunks);
    });

    const queryVec = await provider.embed("The quick brown fox");
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
      await repo.upsertFileChunks(scopedDb, userId, path, chunks);
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
      await repo.upsertFileChunks(scopedDb, freshUserId, path, chunks);
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
