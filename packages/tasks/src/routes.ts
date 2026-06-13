import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";

import type { AccessContext, DataContextRunner, TaskStatus } from "@jarv1s/db";
import {
  addTaskActivityRouteSchema,
  atRiskTasksRouteSchema,
  breakdownTaskRouteSchema,
  createTaskListRouteSchema,
  createTaskRouteSchema,
  createTaskTagRouteSchema,
  deferredTaskStatusRouteSchema,
  deleteTaskListRouteSchema,
  deleteTaskTagRouteSchema,
  focusTasksRouteSchema,
  getTaskPreferencesRouteSchema,
  getTaskRouteSchema,
  listSubtasksRouteSchema,
  listTaskActivityRouteSchema,
  listTaskListsRouteSchema,
  listTaskTagsRouteSchema,
  listTasksRouteSchema,
  overdueTasksRouteSchema,
  renameTaskListRouteSchema,
  renameTaskTagRouteSchema,
  updateTaskPreferencesRouteSchema,
  updateTaskRouteSchema
} from "@jarv1s/shared";

import { sendJob } from "@jarv1s/jobs";

import { handleRouteError } from "@jarv1s/module-sdk";

import { HttpError } from "./errors.js";
import { type DeferredTaskStatusPayload, isDeferredTaskStatusPayloadMetadataOnly } from "./jobs.js";
import { TASKS_DEFERRED_STATUS_QUEUE } from "./manifest.js";
import { reconcileRecurrenceSchedule } from "./recurrence-schedule.js";
import { TaskBreakdownRepository } from "./breakdown.js";
import { TaskDriftRepository } from "./drift.js";
import { TaskListsRepository } from "./lists.js";
import { TaskPreferencesRepository } from "./preferences.js";
import { TasksRepository } from "./repository.js";
import {
  filterByQuadrant,
  serializeTask,
  serializeTaskActivity,
  serializeTaskList,
  serializeTaskPreferences,
  serializeTaskTag
} from "./serialize.js";

export interface TasksRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly boss: PgBoss;
  readonly repository?: TasksRepository;
  readonly listsRepository?: TaskListsRepository;
  readonly breakdownRepository?: TaskBreakdownRepository;
  readonly driftRepository?: TaskDriftRepository;
  readonly preferencesRepository?: TaskPreferencesRepository;
}

interface TaskParams {
  readonly id: string;
}

export function registerTasksRoutes(
  server: FastifyInstance,
  dependencies: TasksRoutesDependencies
): void {
  const repository = dependencies.repository ?? new TasksRepository();
  const listsRepository = dependencies.listsRepository ?? new TaskListsRepository();
  const breakdownRepository = dependencies.breakdownRepository ?? new TaskBreakdownRepository();
  const driftRepository = dependencies.driftRepository ?? new TaskDriftRepository();
  const prefsRepository = dependencies.preferencesRepository ?? new TaskPreferencesRepository();

  server.get("/api/tasks", { schema: listTasksRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const query = request.query as Record<string, unknown>;
      const quadrant = optionalString(query["quadrant"], "quadrant");
      if (
        quadrant !== undefined &&
        quadrant !== "do" &&
        quadrant !== "schedule" &&
        quadrant !== "delegate" &&
        quadrant !== "eliminate"
      ) {
        throw new HttpError(400, "quadrant must be do, schedule, delegate, or eliminate");
      }

      const { tasks, tagMap } = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const rows = await repository.listVisible(scopedDb);
          const map = await repository.getTagsForTasks(
            scopedDb,
            rows.map((r) => r.id)
          );
          return { tasks: rows, tagMap: map };
        }
      );

      const filtered = quadrant ? filterByQuadrant(tasks, quadrant) : tasks;

      return { tasks: filtered.map((task) => serializeTask(task, tagMap.get(task.id) ?? [])) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.post("/api/tasks", { schema: createTaskRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const input = parseCreateTaskBody(request.body);
      const { task, tags } = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const row = await repository.create(scopedDb, input);
          const t = await repository.getTagsForTask(scopedDb, row.id);
          return { task: row, tags: t };
        }
      );

      // Recurring create → ensure this actor has the daily roll-forward schedule.
      // Failure-isolated (reconcileRecurrenceSchedule never throws) so it cannot fail the 201.
      if (task.recurrence != null) {
        await reconcileRecurrenceSchedule(dependencies.boss, accessContext.actorUserId);
      }

      return reply.code(201).send({ task: serializeTask(task, tags) });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  // --- Preferences ---

  server.get(
    "/api/tasks/preferences",
    { schema: getTaskPreferencesRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const prefs = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          prefsRepository.getOrCreate(scopedDb)
        );
        return { preferences: serializeTaskPreferences(prefs) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch(
    "/api/tasks/preferences",
    { schema: updateTaskPreferencesRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = requireObject(request.body);
        const defaultView = body["defaultView"];
        if (defaultView !== "priority" && defaultView !== "matrix") {
          throw new HttpError(400, "defaultView must be priority or matrix");
        }
        const prefs = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          prefsRepository.update(scopedDb, defaultView)
        );
        return { preferences: serializeTaskPreferences(prefs) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: TaskParams }>(
    "/api/tasks/:id",
    { schema: getTaskRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { task, tags } = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const row = await repository.getById(scopedDb, request.params.id);
            const t = row ? await repository.getTagsForTask(scopedDb, row.id) : [];
            return { task: row, tags: t };
          }
        );

        if (!task) {
          return reply.code(404).send({ error: "Task not found" });
        }

        return { task: serializeTask(task, tags) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: TaskParams }>(
    "/api/tasks/:id",
    { schema: updateTaskRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = parseUpdateTaskBody(request.body);
        const { task, tags } = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const row = await repository.update(scopedDb, request.params.id, input);
            const t = row ? await repository.getTagsForTask(scopedDb, row.id) : [];
            return { task: row, tags: t };
          }
        );

        if (!task) {
          return reply.code(404).send({ error: "Task not found" });
        }

        return { task: serializeTask(task, tags) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: TaskParams }>(
    "/api/tasks/:id/subtasks",
    { schema: listSubtasksRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { tasks, tagMap } = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const rows = await repository.listByParentId(scopedDb, request.params.id);
            const map = await repository.getTagsForTasks(
              scopedDb,
              rows.map((r) => r.id)
            );
            return { tasks: rows, tagMap: map };
          }
        );
        return { tasks: tasks.map((task) => serializeTask(task, tagMap.get(task.id) ?? [])) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: TaskParams }>(
    "/api/tasks/:id/activity",
    { schema: listTaskActivityRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const activity = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listActivity(scopedDb, request.params.id)
        );

        return { activity: activity.map(serializeTaskActivity) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: TaskParams }>(
    "/api/tasks/:id/activity",
    { schema: addTaskActivityRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = parseActivityBody(request.body);
        const activity = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.addActivity(scopedDb, request.params.id, input)
        );

        return reply.code(201).send({ activity: serializeTaskActivity(activity) });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: TaskParams }>(
    "/api/tasks/:id/deferred-status",
    { schema: deferredTaskStatusRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseDeferredStatusBody(request.body);
        const visibleTask = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.getById(scopedDb, request.params.id)
        );

        if (!visibleTask) {
          return reply.code(404).send({ error: "Task not found" });
        }

        const payload: DeferredTaskStatusPayload = {
          actorUserId: accessContext.actorUserId,
          taskId: request.params.id,
          requestedStatus: body.status,
          idempotencyKey: body.idempotencyKey
        };

        if (
          !isDeferredTaskStatusPayloadMetadataOnly(payload as unknown as Record<string, unknown>)
        ) {
          throw new HttpError(500, "Task job payload contains non-metadata fields");
        }

        const jobId = await sendJob(dependencies.boss, TASKS_DEFERRED_STATUS_QUEUE, payload);

        return reply.code(202).send({ jobId });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  // --- Lists ---

  server.get("/api/tasks/lists", { schema: listTaskListsRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);

      // Per-session self-heal: the Tasks page loads lists on mount, so this is a cheap
      // (one upsert) opportunistic re-establish of the actor's recurrence schedule. It is
      // failure-isolated (reconcileRecurrenceSchedule never throws), so it cannot affect latency
      // beyond the upsert and never fails the request.
      await reconcileRecurrenceSchedule(dependencies.boss, accessContext.actorUserId);

      const lists = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        listsRepository.list(scopedDb)
      );

      return { lists: lists.map(serializeTaskList) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.post("/api/tasks/lists", { schema: createTaskListRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const body = requireObject(request.body);
      const name = requiredString(body["name"], "name");
      const list = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        listsRepository.getOrCreate(scopedDb, name)
      );

      return reply.code(201).send({ list: serializeTaskList(list) });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.patch<{ Params: { listId: string } }>(
    "/api/tasks/lists/:listId",
    { schema: renameTaskListRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = requireObject(request.body);
        const name = requiredString(body["name"], "name");
        const list = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          listsRepository.renameList(scopedDb, request.params.listId, name)
        );

        return { list: serializeTaskList(list) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.delete<{ Params: { listId: string } }>(
    "/api/tasks/lists/:listId",
    { schema: deleteTaskListRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = requireObject(request.body ?? {});
        const reassignToListId = optionalString(body["reassignToListId"], "reassignToListId");
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          listsRepository.deleteList(scopedDb, request.params.listId, reassignToListId)
        );

        return { deleted: true };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  // --- Tags ---

  server.get<{ Params: { listId: string } }>(
    "/api/tasks/lists/:listId/tags",
    { schema: listTaskTagsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const tags = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          listsRepository.listTags(scopedDb, request.params.listId)
        );

        return { tags: tags.map(serializeTaskTag) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: { listId: string } }>(
    "/api/tasks/lists/:listId/tags",
    { schema: createTaskTagRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = requireObject(request.body);
        const name = requiredString(body["name"], "name");
        const tag = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          listsRepository.createTag(scopedDb, request.params.listId, name)
        );

        return reply.code(201).send({ tag: serializeTaskTag(tag) });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: { listId: string; tagId: string } }>(
    "/api/tasks/lists/:listId/tags/:tagId",
    { schema: renameTaskTagRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = requireObject(request.body);
        const name = requiredString(body["name"], "name");
        const tag = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          listsRepository.renameTag(scopedDb, request.params.listId, request.params.tagId, name)
        );

        return { tag: serializeTaskTag(tag) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.delete<{ Params: { listId: string; tagId: string } }>(
    "/api/tasks/lists/:listId/tags/:tagId",
    { schema: deleteTaskTagRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          listsRepository.deleteTag(scopedDb, request.params.listId, request.params.tagId)
        );

        return { deleted: true };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  // --- Breakdown ---

  server.post<{ Params: TaskParams }>(
    "/api/tasks/:id/breakdown",
    { schema: breakdownTaskRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = requireObject(request.body);
        const steps = parseStringArray(body["steps"], "steps");
        const { tasks, tagMap } = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const rows = await breakdownRepository.breakDown(scopedDb, request.params.id, steps);
            const map = await repository.getTagsForTasks(
              scopedDb,
              rows.map((r) => r.id)
            );
            return { tasks: rows, tagMap: map };
          }
        );

        return reply
          .code(201)
          .send({ tasks: tasks.map((task) => serializeTask(task, tagMap.get(task.id) ?? [])) });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  // --- Focus / At-Risk / Overdue ---

  server.get("/api/tasks/focus", { schema: focusTasksRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const { tasks, tagMap } = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const rows = await driftRepository.getFocus(scopedDb);
          const map = await repository.getTagsForTasks(
            scopedDb,
            rows.map((r) => r.id)
          );
          return { tasks: rows, tagMap: map };
        }
      );

      return { tasks: tasks.map((task) => serializeTask(task, tagMap.get(task.id) ?? [])) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get("/api/tasks/at-risk", { schema: atRiskTasksRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const { tasks, tagMap } = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const rows = await driftRepository.getAtRisk(scopedDb);
          const map = await repository.getTagsForTasks(
            scopedDb,
            rows.map((r) => r.id)
          );
          return { tasks: rows, tagMap: map };
        }
      );

      return { tasks: tasks.map((task) => serializeTask(task, tagMap.get(task.id) ?? [])) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get("/api/tasks/overdue", { schema: overdueTasksRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const { tasks, tagMap } = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const rows = await driftRepository.getOverdue(scopedDb);
          const map = await repository.getTagsForTasks(
            scopedDb,
            rows.map((r) => r.id)
          );
          return { tasks: rows, tagMap: map };
        }
      );

      return { tasks: tasks.map((task) => serializeTask(task, tagMap.get(task.id) ?? [])) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });
}

function parseCreateTaskBody(body: unknown) {
  const value = requireObject(body);

  return {
    title: requiredString(value.title, "title"),
    description: optionalNullableString(value.description, "description"),
    status: optionalTaskStatus(value.status) ?? "todo",
    priority: optionalPriority(value.priority),
    dueAt: optionalDate(value.dueAt, "dueAt"),
    listId: optionalString(value.listId, "listId"),
    doAt: optionalDate(value.doAt, "doAt"),
    effort: optionalEffort(value.effort),
    parentTaskId: optionalNullableString(value.parentTaskId, "parentTaskId"),
    recurrence: optionalRecurrence(value.recurrence)
  };
}

function parseUpdateTaskBody(body: unknown) {
  const value = requireObject(body);

  return {
    title: optionalString(value.title, "title"),
    description: optionalNullableString(value.description, "description"),
    status: optionalTaskStatus(value.status),
    priority: optionalPriority(value.priority),
    dueAt: optionalDate(value.dueAt, "dueAt"),
    listId: optionalString(value.listId, "listId"),
    doAt: optionalDate(value.doAt, "doAt"),
    effort: optionalEffort(value.effort),
    parentTaskId: optionalNullableString(value.parentTaskId, "parentTaskId"),
    recurrence: optionalRecurrence(value.recurrence)
  };
}

function parseActivityBody(body: unknown) {
  const value = requireObject(body);

  return {
    activityType: optionalString(value.activityType, "activityType") ?? "comment",
    body: optionalNullableString(value.body, "body")
  };
}

function parseDeferredStatusBody(body: unknown): { status: TaskStatus; idempotencyKey?: string } {
  const value = requireObject(body);

  return {
    status: requiredTaskStatus(value.status),
    idempotencyKey: optionalString(value.idempotencyKey, "idempotencyKey")
  };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected JSON object body");
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, fieldName: string): string {
  const parsed = optionalString(value, fieldName);

  if (!parsed) {
    throw new HttpError(400, `${fieldName} is required`);
  }

  return parsed;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new HttpError(400, `${fieldName} must not be empty`);
  }

  return trimmed;
}

function optionalNullableString(value: unknown, fieldName: string): string | null | undefined {
  // Treat empty string as an explicit null clear (AJV coerces JSON null → "" for
  // anyOf:[string,null] schemas when coerceTypes:"array" is enabled).
  if (value === null || value === "") {
    return null;
  }

  return optionalString(value, fieldName);
}

function optionalEffort(value: unknown): "quick" | "medium" | "large" | null | undefined {
  if (value === undefined) return undefined;
  // Treat empty string as null (AJV coerces JSON null → "" for anyOf:[string,null] schemas).
  if (value === null || value === "") return null;
  if (value === "quick" || value === "medium" || value === "large") return value;
  throw new HttpError(400, "effort must be quick, medium, or large");
}

function optionalRecurrence(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;
  // Treat empty string as null (AJV coerces JSON null → "" for anyOf:[object,null] schemas).
  if (value === null || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "recurrence must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredTaskStatus(value: unknown): TaskStatus {
  const status = optionalTaskStatus(value);

  if (!status) {
    throw new HttpError(400, "status is required");
  }

  return status;
}

function optionalTaskStatus(value: unknown): TaskStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "todo" || value === "done" || value === "archived") {
    return value;
  }

  throw new HttpError(400, "status is invalid");
}

function optionalPriority(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new HttpError(400, "priority must be an integer from 1 to 5");
  }

  return value;
}

function optionalDate(value: unknown, fieldName: string): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  // Treat null or empty string as an explicit null clear (AJV coerces JSON null → "" for
  // anyOf:[string,null] schemas when coerceTypes:"array" is enabled).
  if (value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be an ISO timestamp`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${fieldName} must be an ISO timestamp`);
  }

  return date;
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} must be an array`);
  }

  return value.map((item, i) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new HttpError(400, `${fieldName}[${i.toString()}] must be a non-empty string`);
    }

    return item.trim();
  });
}
