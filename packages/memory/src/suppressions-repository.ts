import { sql } from "kysely";

import type { DataContextDb } from "@jarv1s/db";

import type { FactCategory } from "./facts-repository.js";

export type MemorySuppressionReason = "rejected" | "corrected";
export type MemoryCorrectionSource = "chat" | "pattern-reject";

export interface MemorySuppression {
  readonly id: string;
  readonly ownerUserId: string;
  readonly signature: string;
  readonly category: FactCategory;
  readonly content: string;
  readonly reason: MemorySuppressionReason;
  readonly source: MemoryCorrectionSource;
  readonly factId: string | null;
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
  readonly createdAt: Date;
}

export type MemoryCorrection = MemorySuppression;

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
        (owner_user_id, signature, category, content, reason, source, before_content)
      VALUES
        (${ownerUserId}::uuid, ${data.signature}, ${data.category}, ${data.content},
         ${data.reason}, 'pattern-reject', ${data.content})
      ON CONFLICT (owner_user_id, signature) DO NOTHING
    `.execute(scopedDb.db);
  }

  async insertCorrection(
    scopedDb: DataContextDb,
    ownerUserId: string,
    data: {
      readonly signature: string;
      readonly category: FactCategory;
      readonly content: string;
      readonly factId: string;
      readonly beforeContent: string;
      readonly afterContent: string;
    }
  ): Promise<void> {
    await sql`
      INSERT INTO app.chat_memory_suppressions
        (owner_user_id, signature, category, content, reason, source, fact_id,
         before_content, after_content)
      VALUES
        (${ownerUserId}::uuid, ${data.signature}, ${data.category}, ${data.content},
         'corrected', 'chat', ${data.factId}::uuid, ${data.beforeContent}, ${data.afterContent})
      ON CONFLICT (owner_user_id, signature) DO UPDATE SET
        reason = EXCLUDED.reason,
        source = EXCLUDED.source,
        fact_id = EXCLUDED.fact_id,
        before_content = EXCLUDED.before_content,
        after_content = EXCLUDED.after_content,
        created_at = now()
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
      source: MemoryCorrectionSource;
      fact_id: string | null;
      before_content: string | null;
      after_content: string | null;
      created_at: Date;
    }>`
      SELECT *
      FROM app.chat_memory_suppressions
      WHERE owner_user_id = ${ownerUserId}::uuid
      ORDER BY created_at DESC
    `.execute(scopedDb.db);

    return result.rows.map((row) => this.#mapRow(row));
  }

  async listCorrections(
    scopedDb: DataContextDb,
    ownerUserId: string,
    options: { readonly limit: number; readonly offset: number } = { limit: 25, offset: 0 }
  ): Promise<MemoryCorrection[]> {
    const limit = Math.min(100, Math.max(1, options.limit));
    const offset = Math.max(0, options.offset);
    const result = await sql<{
      id: string;
      owner_user_id: string;
      signature: string;
      category: FactCategory;
      content: string;
      reason: MemorySuppressionReason;
      source: MemoryCorrectionSource;
      fact_id: string | null;
      before_content: string | null;
      after_content: string | null;
      created_at: Date;
    }>`
      SELECT *
      FROM app.chat_memory_suppressions
      WHERE owner_user_id = ${ownerUserId}::uuid
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `.execute(scopedDb.db);

    return result.rows.map((row) => this.#mapRow(row));
  }

  #mapRow(row: {
    id: string;
    owner_user_id: string;
    signature: string;
    category: FactCategory;
    content: string;
    reason: MemorySuppressionReason;
    source: MemoryCorrectionSource;
    fact_id: string | null;
    before_content: string | null;
    after_content: string | null;
    created_at: Date;
  }): MemorySuppression {
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      signature: row.signature,
      category: row.category,
      content: row.content,
      reason: row.reason,
      source: row.source,
      factId: row.fact_id,
      beforeContent: row.before_content,
      afterContent: row.after_content,
      createdAt: row.created_at
    };
  }
}
