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
