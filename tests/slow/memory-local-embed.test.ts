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

      const catKitten = cosine(cat, kitten);
      const catFinance = cosine(cat, finance);

      expect(cat).toHaveLength(768);
      // Related-topic pairs should have high similarity
      expect(catKitten).toBeGreaterThan(0.5);
      // Unrelated-topic pairs should be meaningfully less similar than related ones
      expect(catFinance).toBeLessThan(catKitten);
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
