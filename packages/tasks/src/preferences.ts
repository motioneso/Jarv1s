import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type TaskPreferences } from "@jarv1s/db";

export class TaskPreferencesRepository {
  async getOrCreate(db: DataContextDb): Promise<TaskPreferences> {
    assertDataContextDb(db);

    const existing = await db.db.selectFrom("app.task_preferences").selectAll().executeTakeFirst();
    if (existing) return existing;

    const inserted = await db.db
      .insertInto("app.task_preferences")
      .values({ owner_user_id: sql<string>`app.current_actor_user_id()`, default_view: "priority" })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();

    return inserted ?? this.getOrCreate(db);
  }

  async update(db: DataContextDb, defaultView: "priority" | "matrix"): Promise<TaskPreferences> {
    assertDataContextDb(db);
    await this.getOrCreate(db); // ensure a row exists

    return db.db
      .updateTable("app.task_preferences")
      .set({ default_view: defaultView, updated_at: new Date() })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
