import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

export class PreferencesRepository {
  async upsert(
    scopedDb: DataContextDb,
    ownerUserId: string,
    key: string,
    value: unknown
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .insertInto("app.preferences")
      .values({
        owner_user_id: ownerUserId,
        key,
        value_json: JSON.stringify(value),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.columns(["owner_user_id", "key"]).doUpdateSet({
          value_json: JSON.stringify(value),
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
