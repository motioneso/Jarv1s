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

import { TaskListsRepository } from "./lists.js";

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly priority?: number | null;
  readonly dueAt?: Date | string | null;
  readonly listId?: string;
  readonly doAt?: Date | string | null;
  readonly effort?: "quick" | "medium" | "large" | null;
  readonly parentTaskId?: string | null;
  readonly source?: string;
  readonly sourceRef?: string | null;
  readonly externalKey?: string | null;
  readonly recurrence?: Record<string, unknown> | null;
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly priority?: number | null;
  readonly dueAt?: Date | string | null;
  readonly listId?: string;
  readonly doAt?: Date | string | null;
  readonly effort?: "quick" | "medium" | "large" | null;
  readonly parentTaskId?: string | null;
  readonly recurrence?: Record<string, unknown> | null;
}

export interface AddTaskActivityInput {
  readonly activityType: string;
  readonly body?: string | null;
}

export class TasksRepository {
  private readonly listsRepository = new TaskListsRepository();

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

    const source = input.source ?? "manual";

    // Idempotency: when externalKey is provided, check if a matching task already exists
    // for this (source, external_key) pair. RLS scopes the query to the current actor.
    if (input.externalKey != null) {
      const existing = await scopedDb.db
        .selectFrom("app.tasks")
        .selectAll()
        .where("source", "=", source)
        .where("external_key", "=", input.externalKey)
        .executeTakeFirst();

      if (existing) {
        return existing;
      }
    }

    // Resolve list_id: use the provided listId or fall back to the actor's Personal list.
    const listId =
      input.listId ??
      (await this.listsRepository.getOrCreateDefault(scopedDb)).id;

    const now = new Date();
    const status = input.status ?? "todo";
    const completedAt = status === "done" ? now : null;

    const row = await scopedDb.db
      .insertInto("app.tasks")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        list_id: listId,
        parent_task_id: input.parentTaskId ?? null,
        title: input.title,
        description: input.description ?? null,
        status,
        priority: input.priority ?? null,
        position: 0,
        due_at: input.dueAt ?? null,
        do_at: input.doAt ?? null,
        effort: input.effort ?? null,
        source,
        source_ref: input.sourceRef ?? null,
        external_key: input.externalKey ?? null,
        recurrence: input.recurrence ?? null,
        completed_at: completedAt,
        created_at: now,
        updated_at: now
      })
      .returningAll()
      .executeTakeFirst();

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
    if (input.doAt !== undefined) {
      updates.do_at = input.doAt;
    }
    if (input.effort !== undefined) {
      updates.effort = input.effort;
    }
    if (input.listId !== undefined) {
      updates.list_id = input.listId;
    }
    if (input.parentTaskId !== undefined) {
      updates.parent_task_id = input.parentTaskId;
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
        actor_kind: "user" as const,
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
