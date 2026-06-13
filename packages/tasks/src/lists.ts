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

  async renameList(db: DataContextDb, listId: string, name: string): Promise<TaskList> {
    assertDataContextDb(db);
    try {
      const row = await db.db
        .updateTable("app.task_lists")
        .set({ name, updated_at: new Date() })
        .where("id", "=", listId)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new HttpError(404, "List not found or not accessible");
      return row;
    } catch (err: unknown) {
      if (err instanceof HttpError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("task_lists_owner_name_idx") || message.includes("unique")) {
        throw new HttpError(409, "A list with that name already exists");
      }
      throw err;
    }
  }

  async deleteList(db: DataContextDb, listId: string, reassignToListId?: string): Promise<void> {
    // NOTE: this runs inside the ambient withDataContext transaction (db.db is the RLS-scoped
    // Transaction — data-context.ts), so the reassign drop + task move + list delete below are
    // already atomic. Do NOT open a nested transaction.
    assertDataContextDb(db);

    // 1. EXISTENCE/OWNERSHIP FIRST (Codex finding): a missing/foreign target must be 404, not a
    //    misleading 409 from the last-list guard below. The select is RLS owner-scoped.
    const all = await db.db.selectFrom("app.task_lists").select("id").execute();
    if (!all.some((l) => l.id === listId)) {
      throw new HttpError(404, "List not found or not accessible");
    }

    // 2. Reject a no-op self-reassign (Codex finding): reassigning to the same list would be a
    //    no-op move that then falls through to an ON DELETE RESTRICT 409 — surface 400 instead.
    if (reassignToListId !== undefined && reassignToListId === listId) {
      throw new HttpError(400, "Cannot reassign a list's tasks to itself");
    }

    // 3. Guard: refuse to delete the last remaining list.
    if (all.length <= 1) {
      throw new HttpError(409, "Cannot delete your only list");
    }

    if (reassignToListId) {
      const ownsDest = await this.isOwnedByActor(db, reassignToListId);
      if (!ownsDest) throw new HttpError(404, "Destination list not found or not accessible");

      // Drop assignments whose tag is not in the destination list (list move drops foreign tags —
      // foundation "List move" rule), THEN move the tasks. Mirrors repository.update's list-move
      // drop so the task_tag_list_match invariant holds after the move.
      await db.db
        .deleteFrom("app.task_tag_assignments")
        .where((eb) =>
          eb("task_id", "in", eb.selectFrom("app.tasks").select("id").where("list_id", "=", listId))
        )
        .where((eb) =>
          eb(
            "tag_id",
            "not in",
            eb.selectFrom("app.task_tags").select("id").where("list_id", "=", reassignToListId)
          )
        )
        .execute();

      await db.db
        .updateTable("app.tasks")
        .set({ list_id: reassignToListId, updated_at: new Date() })
        .where("list_id", "=", listId)
        .execute();
    }

    try {
      const deleted = await db.db
        .deleteFrom("app.task_lists")
        .where("id", "=", listId)
        .returning("id")
        .executeTakeFirst();
      if (!deleted) throw new HttpError(404, "List not found or not accessible");
    } catch (err: unknown) {
      if (err instanceof HttpError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      // ON DELETE RESTRICT (app.tasks.list_id FK) raises on a non-empty list.
      if (message.includes("foreign key") || message.includes("violates")) {
        throw new HttpError(409, "List is not empty");
      }
      throw err;
    }
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
