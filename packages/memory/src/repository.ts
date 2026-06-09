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
    chunks: readonly NewChunkData[],
    embedModelName: string,
    embedModelVersion: string,
    sourceKind: string = "vault"
  ): Promise<void> {
    await this.deleteFileChunks(scopedDb, ownerUserId, sourcePath, sourceKind);

    for (const chunk of chunks) {
      const vectorLiteral = `[${chunk.embedding.join(",")}]`;
      await sql`
        INSERT INTO app.memory_chunks
          (owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text,
           embedding, embed_model_name, embed_model_version)
        VALUES
          (${ownerUserId}::uuid, ${sourceKind}, ${chunk.sourcePath}, ${chunk.lineStart},
           ${chunk.lineEnd}, ${chunk.contentHash}, ${chunk.text}, ${vectorLiteral}::vector,
           ${embedModelName}, ${embedModelVersion})
      `.execute(scopedDb.db);
    }
  }

  async deleteFileChunks(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourcePath: string,
    sourceKind: string = "vault"
  ): Promise<void> {
    await sql`
      DELETE FROM app.memory_chunks
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND source_path = ${sourcePath}
        AND source_kind = ${sourceKind}
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
    limit: number,
    sourceKind: string = "vault"
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
        AND source_kind = ${sourceKind}
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

  async getFileIndex(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string,
    sourcePath: string
  ): Promise<{ fileHash: string; embedModelName: string } | null> {
    const result = await sql<{ file_hash: string; embed_model_name: string }>`
      SELECT file_hash, embed_model_name
      FROM app.memory_file_index
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND source_kind = ${sourceKind}
        AND source_path = ${sourcePath}
    `.execute(scopedDb.db);
    const row = result.rows[0];
    return row ? { fileHash: row.file_hash, embedModelName: row.embed_model_name } : null;
  }

  async upsertFileIndex(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string,
    sourcePath: string,
    fileHash: string,
    chunkCount: number,
    embedModelName: string,
    embedModelVersion: string
  ): Promise<void> {
    await sql`
      INSERT INTO app.memory_file_index
        (owner_user_id, source_kind, source_path, file_hash, chunk_count,
         embed_model_name, embed_model_version, ingested_at)
      VALUES
        (${ownerUserId}::uuid, ${sourceKind}, ${sourcePath}, ${fileHash}, ${chunkCount},
         ${embedModelName}, ${embedModelVersion}, now())
      ON CONFLICT (owner_user_id, source_kind, source_path) DO UPDATE SET
        file_hash = EXCLUDED.file_hash,
        chunk_count = EXCLUDED.chunk_count,
        embed_model_name = EXCLUDED.embed_model_name,
        embed_model_version = EXCLUDED.embed_model_version,
        ingested_at = now()
    `.execute(scopedDb.db);
  }

  async deleteFileIndex(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string,
    sourcePath: string
  ): Promise<void> {
    await sql`
      DELETE FROM app.memory_file_index
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND source_kind = ${sourceKind}
        AND source_path = ${sourcePath}
    `.execute(scopedDb.db);
  }

  async listIndexedPaths(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string
  ): Promise<string[]> {
    const result = await sql<{ source_path: string }>`
      SELECT source_path
      FROM app.memory_file_index
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND source_kind = ${sourceKind}
    `.execute(scopedDb.db);
    return result.rows.map((r) => r.source_path);
  }
}
