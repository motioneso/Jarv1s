import type { DataContextDb } from "@jarv1s/db";

import type { EmbeddingProvider } from "./embedding-provider.js";
import type { MemoryRepository, RetrievedChunk } from "./repository.js";

export class MemoryRetriever {
  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly repository: MemoryRepository
  ) {}

  async retrieve(
    scopedDb: DataContextDb,
    query: string,
    limit: number = 10
  ): Promise<RetrievedChunk[]> {
    const queryEmbedding = await this.embeddingProvider.embed(query);
    return this.repository.vectorSearch(scopedDb, queryEmbedding, limit);
  }
}
