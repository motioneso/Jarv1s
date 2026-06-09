import { sql } from "kysely";

import type { DataContextDb } from "@jarv1s/db";

export type FactCategory = "preference" | "fact" | "profile" | "goal";
export type FactStatus = "active" | "superseded";

export interface MemoryFact {
  readonly id: string;
  readonly ownerUserId: string;
  readonly category: FactCategory;
  readonly content: string;
  readonly sourceThreadId: string | null;
  readonly importance: number;
  readonly status: FactStatus;
  readonly supersededAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewFactData {
  readonly category: FactCategory;
  readonly content: string;
  readonly sourceThreadId?: string;
  readonly importance?: number;
}

export class ChatMemoryFactsRepository {
  async insertFact(
    scopedDb: DataContextDb,
    ownerUserId: string,
    data: NewFactData
  ): Promise<MemoryFact> {
    const result = await sql<{
      id: string;
      owner_user_id: string;
      category: FactCategory;
      content: string;
      source_thread_id: string | null;
      importance: number;
      status: FactStatus;
      superseded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>`
      INSERT INTO app.chat_memory_facts
        (owner_user_id, category, content, source_thread_id, importance)
      VALUES
        (${ownerUserId}::uuid, ${data.category}, ${data.content},
         ${data.sourceThreadId ?? null}::uuid,
         ${data.importance ?? 0.5})
      RETURNING *
    `.execute(scopedDb.db);

    return this.#mapRow(result.rows[0]!);
  }

  async listActiveFacts(scopedDb: DataContextDb, ownerUserId: string): Promise<MemoryFact[]> {
    const result = await sql<{
      id: string;
      owner_user_id: string;
      category: FactCategory;
      content: string;
      source_thread_id: string | null;
      importance: number;
      status: FactStatus;
      superseded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>`
      SELECT * FROM app.chat_memory_facts
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND status = 'active'
      ORDER BY importance DESC, created_at DESC
    `.execute(scopedDb.db);
    return result.rows.map((r) => this.#mapRow(r));
  }

  async supersedeFact(scopedDb: DataContextDb, id: string): Promise<void> {
    await sql`
      UPDATE app.chat_memory_facts
      SET status = 'superseded', superseded_at = now(), updated_at = now()
      WHERE id = ${id}::uuid
    `.execute(scopedDb.db);
  }

  async deleteFact(scopedDb: DataContextDb, id: string): Promise<void> {
    await sql`
      DELETE FROM app.chat_memory_facts WHERE id = ${id}::uuid
    `.execute(scopedDb.db);
  }

  async updateFactImportance(
    scopedDb: DataContextDb,
    id: string,
    importance: number
  ): Promise<void> {
    await sql`
      UPDATE app.chat_memory_facts
      SET importance = ${importance}, updated_at = now()
      WHERE id = ${id}::uuid
    `.execute(scopedDb.db);
  }

  #mapRow(r: {
    id: string;
    owner_user_id: string;
    category: FactCategory;
    content: string;
    source_thread_id: string | null;
    importance: number;
    status: FactStatus;
    superseded_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }): MemoryFact {
    return {
      id: r.id,
      ownerUserId: r.owner_user_id,
      category: r.category,
      content: r.content,
      sourceThreadId: r.source_thread_id,
      importance: Number(r.importance),
      status: r.status,
      supersededAt: r.superseded_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }
}
