export const TASK_STATUSES = ["todo", "done", "archived"] as const;

export type TaskApiStatus = (typeof TASK_STATUSES)[number];

export interface TaskDto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly listId: string;
  readonly parentTaskId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskApiStatus;
  readonly priority: number | null;
  readonly position: number;
  readonly dueAt: string | null;
  readonly doAt: string | null;
  readonly effort: "quick" | "medium" | "large" | null;
  readonly source: string;
  readonly sourceRef: string | null;
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
  readonly status?: TaskApiStatus;
  readonly priority?: number | null;
  readonly dueAt?: string | null;
  readonly listId?: string;
  readonly doAt?: string | null;
  readonly effort?: "quick" | "medium" | "large" | null;
  readonly parentTaskId?: string | null;
  readonly recurrence?: Record<string, unknown> | null;
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
  readonly status?: TaskApiStatus;
  readonly priority?: number | null;
  readonly dueAt?: string | null;
  readonly listId?: string;
  readonly doAt?: string | null;
  readonly effort?: "quick" | "medium" | "large" | null;
  readonly parentTaskId?: string | null;
  readonly recurrence?: Record<string, unknown> | null;
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

export interface ListTaskActivityResponse {
  readonly activity: readonly TaskActivityDto[];
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

const nullableEffortSchema = {
  anyOf: [{ type: "string", enum: ["quick", "medium", "large"] }, { type: "null" }]
} as const;

export const taskDtoSchema = {
  type: "object",
  required: [
    "id",
    "ownerUserId",
    "listId",
    "parentTaskId",
    "title",
    "description",
    "status",
    "priority",
    "position",
    "dueAt",
    "doAt",
    "effort",
    "source",
    "sourceRef",
    "completedAt",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    listId: { type: "string" },
    parentTaskId: nullableStringSchema,
    title: { type: "string" },
    description: nullableStringSchema,
    status: taskStatusSchema,
    priority: nullableNumberSchema,
    position: { type: "number" },
    dueAt: nullableStringSchema,
    doAt: nullableStringSchema,
    effort: nullableEffortSchema,
    source: { type: "string" },
    sourceRef: nullableStringSchema,
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
    status: taskStatusSchema,
    priority: {
      anyOf: [{ type: "integer", minimum: 1, maximum: 5 }, { type: "null" }]
    },
    dueAt: nullableStringSchema,
    listId: { type: "string" },
    doAt: nullableStringSchema,
    effort: nullableEffortSchema,
    parentTaskId: nullableStringSchema,
    recurrence: {
      anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
    }
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
    status: taskStatusSchema,
    priority: {
      anyOf: [{ type: "integer", minimum: 1, maximum: 5 }, { type: "null" }]
    },
    dueAt: nullableStringSchema,
    listId: { type: "string" },
    doAt: nullableStringSchema,
    effort: nullableEffortSchema,
    parentTaskId: nullableStringSchema,
    recurrence: {
      anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
    }
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
  required: ["actorUserId", "taskId", "requestedStatus"],
  properties: {
    actorUserId: { type: "string" },
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

export const listTaskActivityResponseSchema = {
  type: "object",
  required: ["activity"],
  properties: {
    activity: { type: "array", items: taskActivityDtoSchema }
  }
} as const;

export const listTaskActivityRouteSchema = {
  params: taskParamsSchema,
  response: {
    200: listTaskActivityResponseSchema
  }
} as const;

export const deferredTaskStatusRouteSchema = {
  params: taskParamsSchema,
  body: deferredTaskStatusRequestSchema,
  response: {
    202: deferredTaskStatusResponseSchema
  }
} as const;

// --- Task Lists ---

export interface TaskListDto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly position: number;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface ListTaskListsResponse {
  readonly lists: readonly TaskListDto[];
}

export interface CreateTaskListRequest {
  readonly name: string;
}

export interface CreateTaskListResponse {
  readonly list: TaskListDto;
}

export const taskListDtoSchema = {
  type: "object",
  required: ["id", "ownerUserId", "name", "position", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    name: { type: "string" },
    position: { type: "number" },
    createdAt: nullableStringSchema,
    updatedAt: nullableStringSchema
  }
} as const;

export const listTaskListsResponseSchema = {
  type: "object",
  required: ["lists"],
  properties: {
    lists: { type: "array", items: taskListDtoSchema }
  }
} as const;

export const createTaskListRequestSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" }
  }
} as const;

export const createTaskListResponseSchema = {
  type: "object",
  required: ["list"],
  properties: {
    list: taskListDtoSchema
  }
} as const;

export const listTaskListsRouteSchema = {
  response: {
    200: listTaskListsResponseSchema
  }
} as const;

export const taskListParamsSchema = {
  type: "object",
  required: ["listId"],
  properties: {
    listId: { type: "string" }
  }
} as const;

export const createTaskListRouteSchema = {
  body: createTaskListRequestSchema,
  response: {
    201: createTaskListResponseSchema
  }
} as const;

// --- Task Tags ---

export interface TaskTagDto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly listId: string;
  readonly name: string;
  readonly createdAt: string | null;
}

export interface ListTaskTagsResponse {
  readonly tags: readonly TaskTagDto[];
}

export interface CreateTaskTagRequest {
  readonly name: string;
}

export interface CreateTaskTagResponse {
  readonly tag: TaskTagDto;
}

export const taskTagDtoSchema = {
  type: "object",
  required: ["id", "ownerUserId", "listId", "name", "createdAt"],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    listId: { type: "string" },
    name: { type: "string" },
    createdAt: nullableStringSchema
  }
} as const;

export const listTaskTagsResponseSchema = {
  type: "object",
  required: ["tags"],
  properties: {
    tags: { type: "array", items: taskTagDtoSchema }
  }
} as const;

export const createTaskTagRequestSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" }
  }
} as const;

export const createTaskTagResponseSchema = {
  type: "object",
  required: ["tag"],
  properties: {
    tag: taskTagDtoSchema
  }
} as const;

export const listTaskTagsRouteSchema = {
  params: taskListParamsSchema,
  response: {
    200: listTaskTagsResponseSchema
  }
} as const;

export const createTaskTagRouteSchema = {
  params: taskListParamsSchema,
  body: createTaskTagRequestSchema,
  response: {
    201: createTaskTagResponseSchema
  }
} as const;

// --- Task Breakdown ---

export interface BreakdownTaskRequest {
  readonly steps: readonly string[];
}

export interface BreakdownTaskResponse {
  readonly tasks: readonly TaskDto[];
}

export const breakdownTaskRequestSchema = {
  type: "object",
  required: ["steps"],
  properties: {
    steps: { type: "array", items: { type: "string" } }
  }
} as const;

export const breakdownTaskResponseSchema = {
  type: "object",
  required: ["tasks"],
  properties: {
    tasks: { type: "array", items: taskDtoSchema }
  }
} as const;

export const breakdownTaskRouteSchema = {
  params: taskParamsSchema,
  body: breakdownTaskRequestSchema,
  response: {
    201: breakdownTaskResponseSchema
  }
} as const;

// --- Focus / At-Risk / Overdue (reuse listTasksResponseSchema shape) ---

export const focusTasksRouteSchema = {
  response: {
    200: listTasksResponseSchema
  }
} as const;

export const atRiskTasksRouteSchema = {
  response: {
    200: listTasksResponseSchema
  }
} as const;

export const overdueTasksRouteSchema = {
  response: {
    200: listTasksResponseSchema
  }
} as const;

// --- Task Preferences ---

export type TaskDefaultView = "priority" | "matrix";

export interface TaskPreferencesDto {
  readonly defaultView: TaskDefaultView;
  readonly updatedAt: string | null;
}

export interface GetTaskPreferencesResponse {
  readonly preferences: TaskPreferencesDto;
}

export interface UpdateTaskPreferencesRequest {
  readonly defaultView: TaskDefaultView;
}

export interface UpdateTaskPreferencesResponse {
  readonly preferences: TaskPreferencesDto;
}

export const taskPreferencesDtoSchema = {
  type: "object",
  required: ["defaultView", "updatedAt"],
  properties: {
    defaultView: { type: "string", enum: ["priority", "matrix"] },
    updatedAt: nullableStringSchema
  }
} as const;

export const getTaskPreferencesResponseSchema = {
  type: "object",
  required: ["preferences"],
  properties: { preferences: taskPreferencesDtoSchema }
} as const;

export const updateTaskPreferencesRequestSchema = {
  type: "object",
  required: ["defaultView"],
  properties: { defaultView: { type: "string", enum: ["priority", "matrix"] } }
} as const;

export const getTaskPreferencesRouteSchema = {
  response: { 200: getTaskPreferencesResponseSchema }
} as const;

export const updateTaskPreferencesRouteSchema = {
  body: updateTaskPreferencesRequestSchema,
  response: { 200: getTaskPreferencesResponseSchema }
} as const;

export const listSubtasksRouteSchema = {
  params: taskParamsSchema,
  response: { 200: listTasksResponseSchema }
} as const;
