export const TASK_VISIBILITIES = ["private", "workspace"] as const;
export const TASK_STATUSES = ["todo", "in_progress", "done", "archived"] as const;

export type TaskApiVisibility = (typeof TASK_VISIBILITIES)[number];
export type TaskApiStatus = (typeof TASK_STATUSES)[number];

export interface TaskDto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly workspaceId: string | null;
  readonly visibility: TaskApiVisibility;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskApiStatus;
  readonly priority: number | null;
  readonly dueAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface TaskActivityDto {
  readonly id: string;
  readonly taskId: string;
  readonly actorUserId: string;
  readonly activityType: string;
  readonly body: string | null;
  readonly createdAt: string | null;
}

export interface ListTasksResponse {
  readonly tasks: readonly TaskDto[];
}

export interface CreateTaskRequest {
  readonly title: string;
  readonly description?: string | null;
  readonly visibility?: TaskApiVisibility;
  readonly workspaceId?: string | null;
  readonly status?: TaskApiStatus;
  readonly priority?: number | null;
  readonly dueAt?: string | null;
}

export interface CreateTaskResponse {
  readonly task: TaskDto;
}

export interface GetTaskResponse {
  readonly task: TaskDto;
}

export interface UpdateTaskRequest {
  readonly title?: string;
  readonly description?: string | null;
  readonly visibility?: TaskApiVisibility;
  readonly workspaceId?: string | null;
  readonly status?: TaskApiStatus;
  readonly priority?: number | null;
  readonly dueAt?: string | null;
}

export interface UpdateTaskResponse {
  readonly task: TaskDto;
}

export interface AddTaskActivityRequest {
  readonly activityType?: string;
  readonly body?: string | null;
}

export interface AddTaskActivityResponse {
  readonly activity: TaskActivityDto;
}

export interface DeferredTaskStatusRequest {
  readonly status: TaskApiStatus;
  readonly idempotencyKey?: string;
}

export interface DeferredTaskStatusResponse {
  readonly jobId: string | null;
}

export interface DeferredTaskStatusPayloadDto {
  readonly actorUserId: string;
  readonly workspaceId: string | null;
  readonly taskId: string;
  readonly requestedStatus: TaskApiStatus;
  readonly idempotencyKey?: string;
}

const nullableStringSchema = {
  anyOf: [{ type: "string" }, { type: "null" }]
} as const;

const nullableNumberSchema = {
  anyOf: [{ type: "number" }, { type: "null" }]
} as const;

export const taskVisibilitySchema = {
  type: "string",
  enum: TASK_VISIBILITIES
} as const;

export const taskStatusSchema = {
  type: "string",
  enum: TASK_STATUSES
} as const;

export const taskParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string" }
  }
} as const;

export const taskDtoSchema = {
  type: "object",
  required: [
    "id",
    "ownerUserId",
    "workspaceId",
    "visibility",
    "title",
    "description",
    "status",
    "priority",
    "dueAt",
    "completedAt",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    workspaceId: nullableStringSchema,
    visibility: taskVisibilitySchema,
    title: { type: "string" },
    description: nullableStringSchema,
    status: taskStatusSchema,
    priority: nullableNumberSchema,
    dueAt: nullableStringSchema,
    completedAt: nullableStringSchema,
    createdAt: nullableStringSchema,
    updatedAt: nullableStringSchema
  }
} as const;

export const taskActivityDtoSchema = {
  type: "object",
  required: ["id", "taskId", "actorUserId", "activityType", "body", "createdAt"],
  properties: {
    id: { type: "string" },
    taskId: { type: "string" },
    actorUserId: { type: "string" },
    activityType: { type: "string" },
    body: nullableStringSchema,
    createdAt: nullableStringSchema
  }
} as const;

export const listTasksResponseSchema = {
  type: "object",
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      items: taskDtoSchema
    }
  }
} as const;

export const createTaskRequestSchema = {
  type: "object",
  required: ["title"],
  properties: {
    title: { type: "string" },
    description: nullableStringSchema,
    visibility: taskVisibilitySchema,
    workspaceId: nullableStringSchema,
    status: taskStatusSchema,
    priority: {
      anyOf: [{ type: "integer", minimum: -32768, maximum: 32767 }, { type: "null" }]
    },
    dueAt: nullableStringSchema
  }
} as const;

export const createTaskResponseSchema = {
  type: "object",
  required: ["task"],
  properties: {
    task: taskDtoSchema
  }
} as const;

export const getTaskResponseSchema = createTaskResponseSchema;

export const updateTaskRequestSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: nullableStringSchema,
    visibility: taskVisibilitySchema,
    workspaceId: nullableStringSchema,
    status: taskStatusSchema,
    priority: {
      anyOf: [{ type: "integer", minimum: -32768, maximum: 32767 }, { type: "null" }]
    },
    dueAt: nullableStringSchema
  }
} as const;

export const updateTaskResponseSchema = createTaskResponseSchema;

export const addTaskActivityRequestSchema = {
  type: "object",
  properties: {
    activityType: { type: "string" },
    body: nullableStringSchema
  }
} as const;

export const addTaskActivityResponseSchema = {
  type: "object",
  required: ["activity"],
  properties: {
    activity: taskActivityDtoSchema
  }
} as const;

export const deferredTaskStatusRequestSchema = {
  type: "object",
  required: ["status"],
  properties: {
    status: taskStatusSchema,
    idempotencyKey: { type: "string" }
  }
} as const;

export const deferredTaskStatusResponseSchema = {
  type: "object",
  required: ["jobId"],
  properties: {
    jobId: nullableStringSchema
  }
} as const;

export const deferredTaskStatusPayloadSchema = {
  type: "object",
  required: ["actorUserId", "workspaceId", "taskId", "requestedStatus"],
  properties: {
    actorUserId: { type: "string" },
    workspaceId: nullableStringSchema,
    taskId: { type: "string" },
    requestedStatus: taskStatusSchema,
    idempotencyKey: { type: "string" }
  }
} as const;

export const listTasksRouteSchema = {
  response: {
    200: listTasksResponseSchema
  }
} as const;

export const createTaskRouteSchema = {
  body: createTaskRequestSchema,
  response: {
    201: createTaskResponseSchema
  }
} as const;

export const getTaskRouteSchema = {
  params: taskParamsSchema,
  response: {
    200: getTaskResponseSchema
  }
} as const;

export const updateTaskRouteSchema = {
  params: taskParamsSchema,
  body: updateTaskRequestSchema,
  response: {
    200: updateTaskResponseSchema
  }
} as const;

export const addTaskActivityRouteSchema = {
  params: taskParamsSchema,
  body: addTaskActivityRequestSchema,
  response: {
    201: addTaskActivityResponseSchema
  }
} as const;

export const deferredTaskStatusRouteSchema = {
  params: taskParamsSchema,
  body: deferredTaskStatusRequestSchema,
  response: {
    202: deferredTaskStatusResponseSchema
  }
} as const;
