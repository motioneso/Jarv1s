import type { DataContextDb, Entity } from "@jarv1s/db";
import type { EntityType, ProvenanceKind } from "./types.js";

export interface CreateEntityInput {
  readonly ownerUserId: string;
  readonly type: EntityType;
  readonly name: string;
  readonly provenance: ProvenanceKind;
  readonly attributes?: Record<string, unknown>;
  readonly vaultNotePath?: string;
  readonly connectorRefs?: Record<string, unknown>;
  readonly lifeArea?: string;
}

export interface UpdateEntityInput {
  readonly name?: string;
  readonly attributes?: Record<string, unknown>;
  readonly provenance?: ProvenanceKind;
  readonly vaultNotePath?: string | null;
  readonly connectorRefs?: Record<string, unknown> | null;
  readonly lifeArea?: string | null;
}

export class EntitiesRepository {
  async create(scopedDb: DataContextDb, input: CreateEntityInput): Promise<Entity> {
    const row = await scopedDb.db
      .insertInto("app.entities")
      .values({
        owner_user_id: input.ownerUserId,
        type: input.type,
        name: input.name,
        provenance: input.provenance,
        attributes: JSON.stringify(input.attributes ?? {}),
        vault_note_path: input.vaultNotePath ?? null,
        connector_refs: input.connectorRefs ? JSON.stringify(input.connectorRefs) : null,
        life_area: input.lifeArea ?? null
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as Entity;
  }

  async listVisible(scopedDb: DataContextDb): Promise<Entity[]> {
    const rows = await scopedDb.db
      .selectFrom("app.entities")
      .selectAll()
      .orderBy("name", "asc")
      .execute();
    return rows as Entity[];
  }

  async get(scopedDb: DataContextDb, id: string): Promise<Entity | undefined> {
    const row = await scopedDb.db
      .selectFrom("app.entities")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row as Entity | undefined;
  }

  async update(
    scopedDb: DataContextDb,
    id: string,
    input: UpdateEntityInput
  ): Promise<Entity | undefined> {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) updates["name"] = input.name;
    if (input.attributes !== undefined) updates["attributes"] = JSON.stringify(input.attributes);
    if (input.provenance !== undefined) updates["provenance"] = input.provenance;
    if (input.vaultNotePath !== undefined) updates["vault_note_path"] = input.vaultNotePath;
    if (input.connectorRefs !== undefined)
      updates["connector_refs"] = input.connectorRefs ? JSON.stringify(input.connectorRefs) : null;
    if (input.lifeArea !== undefined) updates["life_area"] = input.lifeArea;

    const row = await scopedDb.db
      .updateTable("app.entities")
      .set(updates)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row as Entity | undefined;
  }

  async delete(scopedDb: DataContextDb, id: string): Promise<void> {
    await scopedDb.db.deleteFrom("app.entities").where("id", "=", id).execute();
  }
}
