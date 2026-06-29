import { sql } from "kysely";
import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

function jsonb(value: unknown) {
  return sql<Record<string, unknown>>`${JSON.stringify(value)}::jsonb`;
}

export class PreferencesRepository {
  async upsert(scopedDb: DataContextDb, key: string, value: unknown): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .insertInto("app.preferences")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        key,
        value_json: jsonb(value),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.columns(["owner_user_id", "key"]).doUpdateSet({
          value_json: jsonb(value),
          updated_at: new Date()
        })
      )
      .execute();
  }

  async get(scopedDb: DataContextDb, key: string): Promise<unknown> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.preferences")
      .select("value_json")
      .where("key", "=", key)
      .executeTakeFirst();
    return row?.value_json ?? null;
  }

  async getWithMetadata<T>(
    scopedDb: DataContextDb,
    key: string
  ): Promise<{ value: T; updatedAt: Date } | null> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.preferences")
      .select(["value_json", "updated_at"])
      .where("key", "=", key)
      .executeTakeFirst();
    if (!row) return null;
    return {
      value: row.value_json as T,
      updatedAt: row.updated_at
    };
  }

  async list(scopedDb: DataContextDb): Promise<Record<string, unknown>> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.preferences")
      .select(["key", "value_json"])
      .execute();
    return Object.fromEntries(rows.map((r) => [r.key, r.value_json]));
  }

  async delete(scopedDb: DataContextDb, key: string): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db.deleteFrom("app.preferences").where("key", "=", key).execute();
  }
}
