import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";

import type {
  AccessContext,
  DataContextRunner,
  Task,
  TaskActivity,
  TaskStatus,
  TaskVisibility
} from "@jarv1s/db";
import {
  addTaskActivityRouteSchema,
  createTaskRouteSchema,
  deferredTaskStatusRouteSchema,
  getTaskRouteSchema,
  listTasksRouteSchema,
  updateTaskRouteSchema,
  type TaskActivityDto,
  type TaskDto
} from "@jarv1s/shared";

import { type DeferredTaskStatusPayload, isDeferredTaskStatusPayloadMetadataOnly } from "./jobs.js";
import { TASKS_DEFERRED_STATUS_QUEUE } from "./manifest.js";
import { TasksRepository } from "./repository.js";

export interface TasksRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly boss: PgBoss;
  readonly repository?: TasksRepository;
}

interface TaskParams {
  readonly id: string;
}

export function registerTasksRoutes(
  server: FastifyInstance,
  dependencies: TasksRoutesDependencies
): void {
  const repository = dependencies.repository ?? new TasksRepository();

  server.get("/api/tasks", { schema: listTasksRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const tasks = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        repository.listVisible(scopedDb)
      );

      return { tasks: tasks.map(serializeTask) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.post("/api/tasks", { schema: createTaskRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const input = parseCreateTaskBody(request.body);
      ensureWorkspaceVisibilityContext(accessContext, input);
      const task = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        repository.create(scopedDb, input)
      );

      return reply.code(201).send({ task: serializeTask(task) });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get<{ Params: TaskParams }>(
    "/api/tasks/:id",
    { schema: getTaskRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const task = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.getById(scopedDb, request.params.id)
        );

        if (!task) {
          return reply.code(404).send({ error: "Task not found" });
        }

        return { task: serializeTask(task) };
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
        ensureWorkspaceVisibilityContext(accessContext, input);
        const task = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.update(scopedDb, request.params.id, input)
        );

        if (!task) {
          return reply.code(404).send({ error: "Task not found" });
        }

        return { task: serializeTask(task) };
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
          workspaceId: accessContext.workspaceId ?? null,
          taskId: request.params.id,
          requestedStatus: body.status,
          idempotencyKey: body.idempotencyKey
        };

        if (
          !isDeferredTaskStatusPayloadMetadataOnly(payload as unknown as Record<string, unknown>)
        ) {
          throw new HttpError(500, "Task job payload contains non-metadata fields");
        }

        const jobId = await dependencies.boss.send(TASKS_DEFERRED_STATUS_QUEUE, payload);

        return reply.code(202).send({ jobId });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

function parseCreateTaskBody(body: unknown) {
  const value = requireObject(body);
  const visibility = optionalTaskVisibility(value.visibility) ?? "private";
  const workspaceId =
    visibility === "workspace" ? requiredString(value.workspaceId, "workspaceId") : null;

  return {
    title: requiredString(value.title, "title"),
    description: optionalNullableString(value.description, "description"),
    visibility,
    workspaceId,
    status: optionalTaskStatus(value.status) ?? "todo",
    priority: optionalPriority(value.priority),
    dueAt: optionalDate(value.dueAt, "dueAt")
  };
}

function parseUpdateTaskBody(body: unknown) {
  const value = requireObject(body);
  const visibility = optionalTaskVisibility(value.visibility);

  if (visibility === "workspace" && value.workspaceId === undefined) {
    throw new HttpError(400, "workspaceId is required for workspace-visible tasks");
  }

  return {
    title: optionalString(value.title, "title"),
    description: optionalNullableString(value.description, "description"),
    visibility,
    workspaceId: optionalNullableString(value.workspaceId, "workspaceId"),
    status: optionalTaskStatus(value.status),
    priority: optionalPriority(value.priority),
    dueAt: optionalDate(value.dueAt, "dueAt")
  };
}

function ensureWorkspaceVisibilityContext(
  accessContext: AccessContext,
  input: { readonly visibility?: TaskVisibility; readonly workspaceId?: string | null }
): void {
  if (input.visibility !== "workspace") {
    return;
  }

  if (!accessContext.workspaceId || input.workspaceId !== accessContext.workspaceId) {
    throw new HttpError(400, "workspace-visible tasks require the active workspace context");
  }
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
  if (value === null) {
    return null;
  }

  return optionalString(value, fieldName);
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

  if (value === "todo" || value === "in_progress" || value === "done" || value === "archived") {
    return value;
  }

  throw new HttpError(400, "status is invalid");
}

function optionalTaskVisibility(value: unknown): TaskVisibility | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "private" || value === "workspace") {
    return value;
  }

  throw new HttpError(400, "visibility is invalid");
}

function optionalPriority(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < -32768 || value > 32767) {
    throw new HttpError(400, "priority must be a small integer");
  }

  return value;
}

function optionalDate(value: unknown, fieldName: string): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
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

export function serializeTask(task: Task): TaskDto {
  return {
    id: task.id,
    ownerUserId: task.owner_user_id,
    workspaceId: task.workspace_id,
    visibility: task.visibility,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: serializeDate(task.due_at),
    completedAt: serializeDate(task.completed_at),
    createdAt: serializeDate(task.created_at),
    updatedAt: serializeDate(task.updated_at)
  };
}

function serializeTaskActivity(activity: TaskActivity): TaskActivityDto {
  return {
    id: activity.id,
    taskId: activity.task_id,
    actorUserId: activity.actor_user_id,
    activityType: activity.activity_type,
    body: activity.body,
    createdAt: serializeDate(activity.created_at)
  };
}

function serializeDate(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  if (error instanceof Error && error.message === "Session is missing or expired") {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  if (error instanceof Error && error.message === "Invalid bearer token") {
    return reply.code(401).send({ error: "Invalid bearer token" });
  }
  if (error instanceof Error && error.message === "Workspace context is unavailable") {
    return reply.code(403).send({ error: "Workspace context is unavailable" });
  }

  throw error;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}
