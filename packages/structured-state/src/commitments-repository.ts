import { assertDataContextDb, type Commitment, type DataContextDb } from "@jarv1s/db";
import type { CommitmentSourceKind, CommitmentStatus, ProvenanceKind } from "./types.js";

export interface CreateCommitmentInput {
  readonly ownerUserId: string;
  readonly title: string;
  readonly provenance: ProvenanceKind;
  readonly counterparty?: string;
  readonly dueAt?: Date;
  readonly sourceKind?: CommitmentSourceKind;
  readonly sourceRef?: string;
  readonly lifeArea?: string;
}

export interface UpdateCommitmentInput {
  readonly title?: string;
  readonly status?: CommitmentStatus;
  readonly counterparty?: string | null;
  readonly dueAt?: Date | null;
  readonly surfacedState?: string | null;
  readonly lifeArea?: string | null;
  readonly provenance?: ProvenanceKind;
}

export class CommitmentsRepository {
  async create(scopedDb: DataContextDb, input: CreateCommitmentInput): Promise<Commitment> {
    assertDataContextDb(scopedDb);
    const result = await scopedDb.db
      .insertInto("app.commitments")
      .values({
        owner_user_id: input.ownerUserId,
        title: input.title,
        provenance: input.provenance,
        counterparty: input.counterparty ?? null,
        due_at: input.dueAt ?? null,
        source_kind: input.sourceKind ?? "manual",
        source_ref: input.sourceRef ?? null,
        life_area: input.lifeArea ?? null
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return result as Commitment;
  }

  async listVisible(scopedDb: DataContextDb): Promise<Commitment[]> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.commitments")
      .selectAll()
      .orderBy("created_at", "desc")
      .execute();
    return rows as Commitment[];
  }

  async get(scopedDb: DataContextDb, id: string): Promise<Commitment | undefined> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.commitments")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row as Commitment | undefined;
  }

  async update(
    scopedDb: DataContextDb,
    id: string,
    input: UpdateCommitmentInput
  ): Promise<Commitment | undefined> {
    assertDataContextDb(scopedDb);
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (input.title !== undefined) updates["title"] = input.title;
    if (input.status !== undefined) updates["status"] = input.status;
    if (input.counterparty !== undefined) updates["counterparty"] = input.counterparty;
    if (input.dueAt !== undefined) updates["due_at"] = input.dueAt;
    if (input.surfacedState !== undefined) updates["surfaced_state"] = input.surfacedState;
    if (input.lifeArea !== undefined) updates["life_area"] = input.lifeArea;
    if (input.provenance !== undefined) updates["provenance"] = input.provenance;

    const row = await scopedDb.db
      .updateTable("app.commitments")
      .set(updates)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row as Commitment | undefined;
  }

  async delete(scopedDb: DataContextDb, id: string): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db.deleteFrom("app.commitments").where("id", "=", id).execute();
  }
}
