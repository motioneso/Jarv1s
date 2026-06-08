import { createHash } from "node:crypto";

import { listVaultFilesRecursive, readVaultFile } from "@jarv1s/vault";
import type { DataContextDb } from "@jarv1s/db";
import type { VaultContext } from "@jarv1s/vault";

import type { EmbeddingProvider } from "./embedding-provider.js";
import { parseDocument } from "./parser.js";
import type { MemoryRepository, NewChunkData } from "./repository.js";

export class MemoryIngestPipeline {
  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly repository: MemoryRepository
  ) {}

  async ingestFile(
    scopedDb: DataContextDb,
    vaultCtx: VaultContext,
    relativePath: string
  ): Promise<void> {
    const content = await readVaultFile(vaultCtx, relativePath);
    const { chunks, wikilinks } = parseDocument(content);

    const newChunks: NewChunkData[] = await Promise.all(
      chunks.map(async (chunk) => ({
        sourcePath: relativePath,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        contentHash: createHash("sha256").update(chunk.text).digest("hex"),
        text: chunk.text,
        embedding: await this.embeddingProvider.embed(chunk.text)
      }))
    );

    await this.repository.upsertFileChunks(
      scopedDb,
      vaultCtx.actorUserId,
      relativePath,
      newChunks,
      this.embeddingProvider.modelName,
      this.embeddingProvider.modelVersion
    );
    await this.repository.replaceFileLinks(scopedDb, vaultCtx.actorUserId, relativePath, wikilinks);
  }

  async deleteFile(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourcePath: string
  ): Promise<void> {
    await this.repository.deleteFileChunks(scopedDb, ownerUserId, sourcePath);
    await this.repository.replaceFileLinks(scopedDb, ownerUserId, sourcePath, []);
  }

  async rebuildFromVault(scopedDb: DataContextDb, vaultCtx: VaultContext): Promise<void> {
    await this.repository.deleteAllForUser(scopedDb, vaultCtx.actorUserId);
    const allFiles = await listVaultFilesRecursive(vaultCtx);
    for (const file of allFiles) {
      if (file.endsWith(".md")) {
        await this.ingestFile(scopedDb, vaultCtx, file);
      }
    }
  }
}
