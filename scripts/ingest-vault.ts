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
