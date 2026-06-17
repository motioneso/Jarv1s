import { sql } from "kysely";

import type { DataContextDb } from "@jarv1s/db";

export type FactCategory = "preference" | "fact" | "profile" | "goal";
export type FactStatus = "active" | "superseded";
export type FactProvenance = "volunteered" | "inferred" | "confirmed";

export interface MemoryFact {
  readonly id: string;
  readonly ownerUserId: string;
  readonly category: FactCategory;
  readonly content: string;
  readonly sourceThreadId: string | null;
  readonly importance: number;
  readonly provenance: FactProvenance;
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
  readonly provenance?: FactProvenance;
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
      provenance: FactProvenance;
      status: FactStatus;
      superseded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>`
      INSERT INTO app.chat_memory_facts
        (owner_user_id, category, content, source_thread_id, importance, provenance)
      VALUES
        (${ownerUserId}::uuid, ${data.category}, ${data.content},
         ${data.sourceThreadId ?? null}::uuid,
         ${data.importance ?? 0.5},
         ${data.provenance ?? "inferred"}::app.provenance_kind)
      RETURNING *
    `.execute(scopedDb.db);

    const row = result.rows[0];
    if (!row) {
      // An INSERT ... RETURNING * always yields the inserted row, so a missing
      // row means the statement was silently rewritten (e.g. a future RLS policy
      // blocking the write) — surface it instead of masking it behind a `!` (#146).
      throw new Error("insertFact returned no row");
    }
    return this.#mapRow(row);
  }

  async listActiveFacts(scopedDb: DataContextDb, ownerUserId: string): Promise<MemoryFact[]> {
    const result = await sql<{
      id: string;
      owner_user_id: string;
      category: FactCategory;
      content: string;
      source_thread_id: string | null;
      importance: number;
      provenance: FactProvenance;
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

  async getActiveFact(scopedDb: DataContextDb, id: string): Promise<MemoryFact | undefined> {
    const result = await sql<{
      id: string;
      owner_user_id: string;
      category: FactCategory;
      content: string;
      source_thread_id: string | null;
      importance: number;
      provenance: FactProvenance;
      status: FactStatus;
      superseded_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>`
      SELECT * FROM app.chat_memory_facts
      WHERE id = ${id}::uuid
        AND status = 'active'
    `.execute(scopedDb.db);
    return result.rows[0] ? this.#mapRow(result.rows[0]) : undefined;
  }

  async supersedeFact(scopedDb: DataContextDb, id: string): Promise<void> {
    await sql`
      UPDATE app.chat_memory_facts
      SET status = 'superseded', superseded_at = now(), updated_at = now()
      WHERE id = ${id}::uuid
    `.execute(scopedDb.db);
  }

  async deleteFact(scopedDb: DataContextDb, id: string): Promise<boolean> {
    const result = await sql<{ id: string }>`
      DELETE FROM app.chat_memory_facts
      WHERE id = ${id}::uuid
      RETURNING id
    `.execute(scopedDb.db);
    return result.rows.length > 0;
  }

  async confirmFact(scopedDb: DataContextDb, id: string): Promise<boolean> {
    const result = await sql<{ id: string }>`
      UPDATE app.chat_memory_facts
      SET provenance = 'confirmed'::app.provenance_kind,
          updated_at = now()
      WHERE id = ${id}::uuid
        AND status = 'active'
        AND provenance = 'inferred'
      RETURNING id
    `.execute(scopedDb.db);
    return result.rows.length > 0;
  }

  async updateFactImportance(
    scopedDb: DataContextDb,
    id: string,
    importance: number
  ): Promise<boolean> {
    const result = await sql<{ id: string }>`
      UPDATE app.chat_memory_facts
      SET importance = ${importance}, updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id
    `.execute(scopedDb.db);
    return result.rows.length > 0;
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
    provenance: FactProvenance;
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
      provenance: r.provenance,
      status: r.status,
      supersededAt: r.superseded_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }
}
