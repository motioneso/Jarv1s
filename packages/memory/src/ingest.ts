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
