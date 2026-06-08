import { randomUUID } from "node:crypto";

import { sql, type Updateable } from "kysely";

import {
  assertDataContextDb,
  type DataContextDb,
  type Task,
  type TaskActivity,
  type TaskStatus,
  type TasksTable
} from "@jarv1s/db";

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly priority?: number | null;
  readonly dueAt?: Date | string | null;
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly priority?: number | null;
  readonly dueAt?: Date | string | null;
}

export interface AddTaskActivityInput {
  readonly activityType: string;
  readonly body?: string | null;
}

export class TasksRepository {
  async listVisible(scopedDb: DataContextDb): Promise<Task[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.tasks")
      .selectAll()
      .orderBy("updated_at", "desc")
      .orderBy("id")
      .execute();
  }

  async getById(scopedDb: DataContextDb, taskId: string): Promise<Task | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.tasks")
      .selectAll()
      .where("id", "=", taskId)
      .executeTakeFirst();
  }

  async create(scopedDb: DataContextDb, input: CreateTaskInput): Promise<Task> {
    assertDataContextDb(scopedDb);

    const now = new Date();
    const status = input.status ?? "todo";

    // list_id is NOT NULL after migration 0039. Default to the actor's Personal list so
    // existing callers that do not supply a list continue to work. The TasksTable type
    // gains list_id in Task 2; until then, use a raw SQL insert to satisfy the constraint
    // without requiring the typed column to be present.
    const id = randomUUID();
    const completedAt = status === "done" ? now : null;
    const result = await sql<Task>`
      INSERT INTO app.tasks
        (id, owner_user_id, list_id, title, description, status, priority,
         due_at, completed_at, created_at, updated_at)
      VALUES (
        ${id},
        app.current_actor_user_id(),
        (SELECT id FROM app.task_lists
         WHERE owner_user_id = app.current_actor_user_id() AND name = 'Personal'
         LIMIT 1),
        ${input.title},
        ${input.description ?? null},
        ${status},
        ${input.priority ?? null},
        ${input.dueAt ?? null},
        ${completedAt},
        ${now},
        ${now}
      )
      RETURNING *
    `.execute(scopedDb.db);

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create task");
    }
    return row;
  }

  async update(
    scopedDb: DataContextDb,
    taskId: string,
    input: UpdateTaskInput
  ): Promise<Task | undefined> {
    assertDataContextDb(scopedDb);

    const updates: Updateable<TasksTable> = {
      updated_at: new Date()
    };

    if (input.title !== undefined) {
      updates.title = input.title;
    }
    if (input.description !== undefined) {
      updates.description = input.description;
    }
    if (input.priority !== undefined) {
      updates.priority = input.priority;
    }
    if (input.dueAt !== undefined) {
      updates.due_at = input.dueAt;
    }
    if (input.status !== undefined) {
      updates.status = input.status;
      updates.completed_at = input.status === "done" ? new Date() : null;
    }

    return scopedDb.db
      .updateTable("app.tasks")
      .set(updates)
      .where("id", "=", taskId)
      .returningAll()
      .executeTakeFirst();
  }

  async updateStatus(
    scopedDb: DataContextDb,
    taskId: string,
    status: TaskStatus
  ): Promise<Task | undefined> {
    return this.update(scopedDb, taskId, { status });
  }

  async addActivity(
    scopedDb: DataContextDb,
    taskId: string,
    input: AddTaskActivityInput
  ): Promise<TaskActivity> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .insertInto("app.task_activity")
      .values({
        id: randomUUID(),
        task_id: taskId,
        actor_user_id: sql<string>`app.current_actor_user_id()`,
        activity_type: input.activityType,
        body: input.body ?? null,
        created_at: new Date()
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listActivity(scopedDb: DataContextDb, taskId: string): Promise<TaskActivity[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.task_activity")
      .selectAll()
      .where("task_id", "=", taskId)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
  }
}
