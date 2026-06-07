import { sql } from "kysely";

import type { DataContextDb } from "@jarv1s/db";

export interface NewChunkData {
  readonly sourcePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly contentHash: string;
  readonly text: string;
  readonly embedding: number[];
}

export interface RetrievedChunk {
  readonly id: string;
  readonly sourcePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly text: string;
  readonly similarity: number;
}

export class MemoryRepository {
  async upsertFileChunks(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourcePath: string,
    chunks: readonly NewChunkData[]
  ): Promise<void> {
    // Delete all existing chunks for this path, then insert fresh.
    await this.deleteFileChunks(scopedDb, ownerUserId, sourcePath);

    for (const chunk of chunks) {
      const vectorLiteral = `[${chunk.embedding.join(",")}]`;
      await sql`
        INSERT INTO app.memory_chunks
          (owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text, embedding)
        VALUES
          (${ownerUserId}::uuid, ${"vault"}, ${chunk.sourcePath}, ${chunk.lineStart},
           ${chunk.lineEnd}, ${chunk.contentHash}, ${chunk.text}, ${vectorLiteral}::vector)
      `.execute(scopedDb.db);
    }
  }

  async deleteFileChunks(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourcePath: string
  ): Promise<void> {
    await sql`
      DELETE FROM app.memory_chunks
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND source_path = ${sourcePath}
    `.execute(scopedDb.db);
  }

  async deleteAllForUser(scopedDb: DataContextDb, ownerUserId: string): Promise<void> {
    await sql`
      DELETE FROM app.memory_chunks WHERE owner_user_id = ${ownerUserId}::uuid
    `.execute(scopedDb.db);
    await sql`
      DELETE FROM app.memory_links WHERE owner_user_id = ${ownerUserId}::uuid
    `.execute(scopedDb.db);
  }

  async vectorSearch(
    scopedDb: DataContextDb,
    embedding: number[],
    limit: number
  ): Promise<RetrievedChunk[]> {
    const vectorLiteral = `[${embedding.join(",")}]`;
    const result = await sql<{
      id: string;
      source_path: string;
      line_start: number;
      line_end: number;
      text: string;
      similarity: number;
    }>`
      SELECT id, source_path, line_start, line_end, text,
             1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM app.memory_chunks
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `.execute(scopedDb.db);

    return result.rows.map((r) => ({
      id: r.id,
      sourcePath: r.source_path,
      lineStart: r.line_start,
      lineEnd: r.line_end,
      text: r.text,
      similarity: r.similarity
    }));
  }

  async replaceFileLinks(
    scopedDb: DataContextDb,
    ownerUserId: string,
    fromPath: string,
    toPaths: readonly string[]
  ): Promise<void> {
    await sql`
      DELETE FROM app.memory_links
      WHERE owner_user_id = ${ownerUserId}::uuid AND from_path = ${fromPath}
    `.execute(scopedDb.db);

    for (const toPath of toPaths) {
      await sql`
        INSERT INTO app.memory_links (owner_user_id, from_path, to_path)
        VALUES (${ownerUserId}::uuid, ${fromPath}, ${toPath})
        ON CONFLICT (owner_user_id, from_path, to_path) DO NOTHING
      `.execute(scopedDb.db);
    }
  }
}
