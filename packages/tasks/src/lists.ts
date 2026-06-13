import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type TaskList, type TaskTag } from "@jarv1s/db";

import { HttpError } from "./errors.js";

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

  async assignTag(db: DataContextDb, taskId: string, tagId: string): Promise<void> {
    assertDataContextDb(db);

    // Deterministic precheck (Codex finding): map a missing/foreign task or tag to 404 instead
    // of letting a raw RLS/FK failure surface as a 500. The task precheck requires OWNERSHIP
    // (owner_user_id = app.current_actor_user_id()), NOT mere visibility — the
    // task_tag_assignments_rw policy (0062_task_tag_assignments_ownership.sql) gates the INSERT
    // on parent-task OWNERSHIP, so a manage-SHARED task is visible via tasks_select yet would
    // fail the assignment WITH CHECK as a raw 500. Prechecking ownership returns a clean 404.
    const task = await db.db
      .selectFrom("app.tasks")
      .select("id")
      .where("id", "=", taskId)
      .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
      .executeTakeFirst();
    if (!task) throw new HttpError(404, "Task not found or not accessible");
    const tag = await db.db
      .selectFrom("app.task_tags")
      .select("id")
      .where("id", "=", tagId)
      .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
      .executeTakeFirst();
    if (!tag) throw new HttpError(404, "Tag not found or not accessible");

    try {
      await db.db
        .insertInto("app.task_tag_assignments")
        .values({ task_id: taskId, tag_id: tagId })
        .onConflict((oc) => oc.doNothing())
        .execute();
    } catch (err: unknown) {
      if (err instanceof HttpError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      // task_tag_list_match trigger message is exactly: tag must belong to the task's list
      if (message.includes("tag must belong to the task")) {
        throw new HttpError(400, "tag must belong to the task's list");
      }
      throw err;
    }
  }

  async unassignTag(db: DataContextDb, taskId: string, tagId: string): Promise<void> {
    assertDataContextDb(db);
    // Ownership precheck (Codex finding): a visible-but-not-owned task would otherwise yield a
    // silent no-op delete + misleading 200. Require ownership and surface 404 deterministically.
    const owned = await db.db
      .selectFrom("app.tasks")
      .select("id")
      .where("id", "=", taskId)
      .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
      .executeTakeFirst();
    if (!owned) throw new HttpError(404, "Task not found or not accessible");
    await db.db
      .deleteFrom("app.task_tag_assignments")
      .where("task_id", "=", taskId)
      .where("tag_id", "=", tagId)
      .execute();
  }

  async isOwnedByActor(db: DataContextDb, listId: string): Promise<boolean> {
    assertDataContextDb(db);
    const row = await db.db
      .selectFrom("app.task_lists")
      .select("id")
      .where("id", "=", listId)
      .executeTakeFirst();
    return !!row; // RLS is owner-only (0039_tasks_foundation.sql); row present = actor owns it
  }
}
