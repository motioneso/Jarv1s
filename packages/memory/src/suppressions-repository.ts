import { sql } from "kysely";

import type { DataContextDb } from "@jarv1s/db";

import type { FactCategory } from "./facts-repository.js";

export type MemorySuppressionReason = "rejected";

export interface MemorySuppression {
  readonly id: string;
  readonly ownerUserId: string;
  readonly signature: string;
  readonly category: FactCategory;
  readonly content: string;
  readonly reason: MemorySuppressionReason;
  readonly createdAt: Date;
}

export interface NewMemorySuppression {
  readonly signature: string;
  readonly category: FactCategory;
  readonly content: string;
  readonly reason: MemorySuppressionReason;
}

export class ChatMemorySuppressionsRepository {
  async insertSuppression(
    scopedDb: DataContextDb,
    ownerUserId: string,
    data: NewMemorySuppression
  ): Promise<void> {
    await sql`
      INSERT INTO app.chat_memory_suppressions
        (owner_user_id, signature, category, content, reason)
      VALUES
        (${ownerUserId}::uuid, ${data.signature}, ${data.category}, ${data.content}, ${data.reason})
      ON CONFLICT (owner_user_id, signature) DO NOTHING
    `.execute(scopedDb.db);
  }

  async isSuppressed(
    scopedDb: DataContextDb,
    ownerUserId: string,
    signature: string
  ): Promise<boolean> {
    const result = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM app.chat_memory_suppressions
        WHERE owner_user_id = ${ownerUserId}::uuid
          AND signature = ${signature}
      ) AS "exists"
    `.execute(scopedDb.db);
    return result.rows[0]?.exists ?? false;
  }

  async listSuppressions(
    scopedDb: DataContextDb,
    ownerUserId: string
  ): Promise<MemorySuppression[]> {
    const result = await sql<{
      id: string;
      owner_user_id: string;
      signature: string;
      category: FactCategory;
      content: string;
      reason: MemorySuppressionReason;
      created_at: Date;
    }>`
      SELECT *
      FROM app.chat_memory_suppressions
      WHERE owner_user_id = ${ownerUserId}::uuid
      ORDER BY created_at DESC
    `.execute(scopedDb.db);

    return result.rows.map((row) => ({
      id: row.id,
      ownerUserId: row.owner_user_id,
      signature: row.signature,
      category: row.category,
      content: row.content,
      reason: row.reason,
      createdAt: row.created_at
    }));
  }
}
