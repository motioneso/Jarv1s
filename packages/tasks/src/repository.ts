import { randomUUID } from "node:crypto";

import { sql, type Updateable } from "kysely";

import {
  assertDataContextDb,
  type DataContextDb,
  type Task,
  type TaskActivity,
  type TaskStatus,
  type TaskTag,
  type TasksTable
} from "@jarv1s/db";

import { HttpError } from "./errors.js";
import { TaskListsRepository } from "./lists.js";
import { generateNext, rollForwardOwnedSeries } from "./recurrence.js";

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

    // Lazy-on-view freshness: advance any stale recurring series before reading so the
    // list reflects the current occurrence between daily cron ticks. No-op when nothing
    // is stale. Owner-only (RLS + explicit owner predicate inside rollForwardOwnedSeries).
    await rollForwardOwnedSeries(scopedDb);

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
    // If a listId is provided, verify the actor owns it (RLS on task_lists is owner-only).
    if (input.listId) {
      const owned = await this.listsRepository.isOwnedByActor(scopedDb, input.listId);
      if (!owned) throw new HttpError(404, "List not found or not accessible");
    }
    // Verify ownership (not just visibility) for parentTaskId.
    // app.tasks RLS is owner-or-share, so a plain getById would succeed for view-shared tasks.
    // We require owner_user_id = current_actor_user_id() explicitly.
    if (input.parentTaskId != null) {
      const parentOwned = await scopedDb.db
        .selectFrom("app.tasks")
        .select("id")
        .where("id", "=", input.parentTaskId)
        .where("owner_user_id", "=", sql<string>`app.current_actor_user_id()`)
        .executeTakeFirst();
      if (!parentOwned) throw new HttpError(404, "Parent task not found or not accessible");
    }
    const listId = input.listId ?? (await this.listsRepository.getOrCreateDefault(scopedDb)).id;

    const now = new Date();
    const status = input.status ?? "todo";
    const completedAt = status === "done" ? now : null;

    // Recurrence: assign a series id and ensure occurrence_date is present in the jsonb.
    let recurrenceValue: Record<string, unknown> | null = null;
    let recurrenceSeriesId: string | null = null;
    if (input.recurrence != null) {
      recurrenceSeriesId = randomUUID();
      // Derive a default occurrence_date from dueAt or today if not supplied.
      const existingOccurrenceDate = input.recurrence["occurrence_date"] as string | undefined;
      let occurrenceDate: string;
      if (existingOccurrenceDate) {
        occurrenceDate = existingOccurrenceDate;
      } else if (input.dueAt != null) {
        const d = typeof input.dueAt === "string" ? new Date(input.dueAt) : input.dueAt;
        occurrenceDate = d.toISOString().slice(0, 10);
      } else {
        occurrenceDate = now.toISOString().slice(0, 10);
      }
      recurrenceValue = { ...input.recurrence, occurrence_date: occurrenceDate };
    }

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
        recurrence: recurrenceValue,
        recurrence_series_id: recurrenceSeriesId,
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

    // Ownership check: if the caller is moving the task to a different list, verify ownership.
    if (input.listId !== undefined) {
      const owned = await this.listsRepository.isOwnedByActor(scopedDb, input.listId);
      if (!owned) throw new HttpError(404, "List not found or not accessible");
    }
    // Ownership check: if the caller is reparenting the task, require owner_user_id match.
    if (input.parentTaskId != null) {
      const parentOwned = await scopedDb.db
        .selectFrom("app.tasks")
        .select("id")
        .where("id", "=", input.parentTaskId)
        .where("owner_user_id", "=", sql<string>`app.current_actor_user_id()`)
        .executeTakeFirst();
      if (!parentOwned) throw new HttpError(404, "Parent task not found or not accessible");
    }

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

    // List move: drop assignments whose tag does not belong to the destination list, BEFORE the
    // move. Same ambient transaction as the rest of update() (withDataContext wraps the callback
    // in one transaction; scopedDb.db is that Transaction), so this is atomic with the move —
    // no nested transaction. Preserves the same-list invariant the task_tag_list_match trigger
    // enforces at assignment time. Matches the delete-with-reassign drop rule (deleteList).
    if (input.listId !== undefined) {
      await scopedDb.db
        .deleteFrom("app.task_tag_assignments")
        .where("task_id", "=", taskId)
        .where((eb) =>
          eb(
            "tag_id",
            "not in",
            eb.selectFrom("app.task_tags").select("id").where("list_id", "=", input.listId!)
          )
        )
        .execute();
    }

    const updated = await scopedDb.db
      .updateTable("app.tasks")
      .set(updates)
      .where("id", "=", taskId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      return undefined;
    }

    // --- Completion cascade ---
    if (input.status !== undefined) {
      const newStatus = input.status;

      if (newStatus === "done" || newStatus === "archived") {
        // Parent closing: cascade to open children.
        if (updated.parent_task_id === null) {
          await this.cascadeCloseChildren(scopedDb, taskId, newStatus);
        }
      }

      if (newStatus === "done" && updated.parent_task_id !== null) {
        // Child completed: check if all siblings are also done; if so, close the parent.
        await this.maybeAutoCloseParent(scopedDb, updated.parent_task_id);
      }

      // Recurrence: when a recurring task transitions to done, generate the next instance.
      // Recurring tasks cannot be parents (enforced by DB trigger), so there is no
      // interaction with the cascade above.
      if (newStatus === "done" && updated.recurrence != null) {
        await generateNext(scopedDb, updated);
      }
    }

    return updated;
  }

  /**
   * When a parent is set to `done` or `archived`, close all open children
   * (those not already in the target terminal status) to match.
   */
  private async cascadeCloseChildren(
    scopedDb: DataContextDb,
    parentId: string,
    parentStatus: "done" | "archived"
  ): Promise<void> {
    const openChildren = await scopedDb.db
      .selectFrom("app.tasks")
      .select("id")
      .where("parent_task_id", "=", parentId)
      .where("status", "!=", parentStatus)
      .execute();

    if (openChildren.length === 0) return;

    const now = new Date();
    for (const child of openChildren) {
      await scopedDb.db
        .updateTable("app.tasks")
        .set({
          status: parentStatus,
          completed_at: parentStatus === "done" ? now : null,
          updated_at: now
        })
        .where("id", "=", child.id)
        .execute();

      await this.addActivity(scopedDb, child.id, {
        activityType: "status_changed",
        body: `Cascaded to ${parentStatus} when parent was closed`
      });
    }
  }

  /**
   * When a child task reaches `done`, check whether all siblings are also
   * `done`. If so, automatically close the parent.
   */
  private async maybeAutoCloseParent(scopedDb: DataContextDb, parentId: string): Promise<void> {
    const siblings = await scopedDb.db
      .selectFrom("app.tasks")
      .select(["id", "status"])
      .where("parent_task_id", "=", parentId)
      .execute();

    if (siblings.length === 0) return;

    const allDone = siblings.every((s) => s.status === "done");
    if (!allDone) return;

    const now = new Date();
    await scopedDb.db
      .updateTable("app.tasks")
      .set({ status: "done", completed_at: now, updated_at: now })
      .where("id", "=", parentId)
      .where("status", "!=", "done")
      .execute();

    await this.addActivity(scopedDb, parentId, {
      activityType: "completed",
      body: "All subtasks completed — parent auto-closed"
    });
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

  async listByParentId(scopedDb: DataContextDb, parentId: string): Promise<Task[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.tasks")
      .selectAll()
      .where("parent_task_id", "=", parentId)
      .orderBy("position", "asc")
      .orderBy("id")
      .execute();
  }

  /**
   * Set of visible task ids that carry the given tag (RLS-scoped). Used by the
   * GET /api/tasks `tagId` filter. The select is owner/share-scoped by RLS on
   * task_tag_assignments, so a foreign tag yields an empty set.
   */
  async taskIdsWithTag(scopedDb: DataContextDb, tagId: string): Promise<Set<string>> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.task_tag_assignments")
      .select("task_id")
      .where("tag_id", "=", tagId)
      .execute();
    return new Set(rows.map((r) => r.task_id));
  }

  async getTagsForTask(scopedDb: DataContextDb, taskId: string): Promise<TaskTag[]> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.task_tag_assignments as a")
      .innerJoin("app.task_tags as g", "g.id", "a.tag_id")
      .selectAll("g")
      .where("a.task_id", "=", taskId)
      .orderBy("g.name")
      .execute();
  }

  /** Batch fetch tags for many tasks in ONE grouped query (avoids N+1). */
  async getTagsForTasks(
    scopedDb: DataContextDb,
    taskIds: readonly string[]
  ): Promise<Map<string, TaskTag[]>> {
    assertDataContextDb(scopedDb);
    const map = new Map<string, TaskTag[]>();
    if (taskIds.length === 0) return map;
    const rows = await scopedDb.db
      .selectFrom("app.task_tag_assignments as a")
      .innerJoin("app.task_tags as g", "g.id", "a.tag_id")
      .select([
        "a.task_id as task_id",
        "g.id as id",
        "g.owner_user_id as owner_user_id",
        "g.list_id as list_id",
        "g.name as name",
        "g.created_at as created_at"
      ])
      .where("a.task_id", "in", taskIds as string[])
      .orderBy("g.name")
      .execute();
    for (const row of rows) {
      const { task_id, ...tag } = row;
      const arr = map.get(task_id) ?? [];
      arr.push(tag as unknown as TaskTag);
      map.set(task_id, arr);
    }
    return map;
  }
}
