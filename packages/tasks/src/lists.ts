import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import {
  assertDataContextDb,
  type DataContextDb,
  type TaskList,
  type TaskTag
} from "@jarv1s/db";

export class TaskListsRepository {
  async getOrCreateDefault(db: DataContextDb): Promise<TaskList> {
    return this.getOrCreate(db, "Personal");
  }

  /**
   * Idempotent get-or-create for a task list by name (case-insensitive via the
   * `task_lists_owner_name_idx` unique index on `(owner_user_id, lower(name))`).
   *
   * Approach: select-first → insert with `ON CONFLICT DO NOTHING` → re-select on
   * null (handles the concurrent-first-insert race).  We use `.onConflict((oc) =>
   * oc.doNothing())` (no conflict-target clause) so Kysely emits plain
   * `ON CONFLICT DO NOTHING`, which is valid PostgreSQL and avoids the need to
   * reference the expression-index target `(owner_user_id, lower(name))` in
   * Kysely's typed column API.
   *
   * Generated SQL for the insert path:
   *   INSERT INTO "app"."task_lists" ("id","owner_user_id","name")
   *   VALUES ($1, app.current_actor_user_id(), $2)
   *   ON CONFLICT DO NOTHING
   *   RETURNING *
   */
  async getOrCreate(db: DataContextDb, name: string): Promise<TaskList> {
    assertDataContextDb(db);

    // 1. Try a fast read first (avoids unnecessary writes on the happy path).
    const existing = await db.db
      .selectFrom("app.task_lists")
      .selectAll()
      .where(sql<boolean>`lower(name) = lower(${name})`)
      .executeTakeFirst();

    if (existing) {
      return existing;
    }

    // 2. Insert — on a unique conflict (concurrent call already inserted this
    //    list), `DO NOTHING` causes RETURNING to return no rows.
    const inserted = await db.db
      .insertInto("app.task_lists")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        name,
        position: 0
      })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted) {
      return inserted;
    }

    // 3. Lost the race — re-select to converge on the winning row.
    const raceWinner = await db.db
      .selectFrom("app.task_lists")
      .selectAll()
      .where(sql<boolean>`lower(name) = lower(${name})`)
      .executeTakeFirstOrThrow();

    return raceWinner;
  }

  async list(db: DataContextDb): Promise<TaskList[]> {
    assertDataContextDb(db);

    return db.db
      .selectFrom("app.task_lists")
      .selectAll()
      .orderBy("position")
      .orderBy("name")
      .execute();
  }

  async createTag(db: DataContextDb, listId: string, name: string): Promise<TaskTag> {
    assertDataContextDb(db);

    return db.db
      .insertInto("app.task_tags")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        list_id: listId,
        name
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listTags(db: DataContextDb, listId: string): Promise<TaskTag[]> {
    assertDataContextDb(db);

    return db.db
      .selectFrom("app.task_tags")
      .selectAll()
      .where("list_id", "=", listId)
      .orderBy("name")
      .execute();
  }
}
