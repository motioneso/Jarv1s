import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  addTaskActivityRequestSchema,
  addTaskActivityResponseSchema,
  assignTaskTagRequestSchema,
  assignTaskTagRouteSchema,
  atRiskTasksResponseSchema,
  breakdownTaskRequestSchema,
  breakdownTaskResponseSchema,
  createTaskListRequestSchema,
  createTaskListResponseSchema,
  createTaskRequestSchema,
  createTaskResponseSchema,
  createTaskTagRequestSchema,
  createTaskTagResponseSchema,
  deferredTaskStatusPayloadSchema,
  deferredTaskStatusRequestSchema,
  deferredTaskStatusResponseSchema,
  deleteTaskListRequestSchema,
  deleteTaskListRouteSchema,
  deleteTaskTagRouteSchema,
  focusTasksResponseSchema,
  getTaskResponseSchema,
  listTaskListsResponseSchema,
  listTaskTagsResponseSchema,
  listTasksResponseSchema,
  overdueTasksResponseSchema,
  renameTaskListRequestSchema,
  renameTaskListRouteSchema,
  renameTaskTagRequestSchema,
  renameTaskTagRouteSchema,
  taskStatusSchema,
  unassignTaskTagRouteSchema,
  updateTaskRequestSchema,
  updateTaskResponseSchema
} from "@jarv1s/shared";

import {
  taskActivityExecute,
  taskAtRiskExecute,
  taskFocusExecute,
  taskGetExecute,
  taskListExecute,
  taskListListsExecute,
  taskListTagsExecute,
  taskOverdueExecute,
  taskUpdateStatusExecute
} from "./tools.js";

export const TASKS_MODULE_ID = "tasks";
export const TASKS_DEFERRED_STATUS_QUEUE = "tasks-deferred-status";
export const TASKS_RECURRENCE_QUEUE = "tasks-recurrence-materialize";
export const tasksModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const tasksModuleManifest = {
  id: TASKS_MODULE_ID,
  name: "Tasks",
  version: "0.1.0",
  publisher: "jarv1s",
  lifecycle: "required",
  compatibility: {
    jarv1s: ">=0.0.0"
  },
  availability: {
    defaultEnabled: true,
    required: true
  },
  database: {
    migrations: [
      "sql/0003_tasks_module.sql",
      "sql/0019_tasks_owner_or_share.sql",
      "sql/0039_tasks_foundation.sql",
      "sql/0075_tasks_worker_recurrence_grant.sql"
    ],
    migrationDirectories: ["packages/tasks/sql"],
    ownedTables: ["app.tasks", "app.task_activity"]
  },
  navigation: [
    {
      id: "tasks",
      label: "Tasks",
      path: "/tasks",
      icon: "check-square",
      order: 10,
      permissionId: "tasks.view"
    }
  ],
  settings: [
    {
      id: "tasks.module-settings",
      label: "Tasks",
      path: "/settings/modules/tasks",
      scope: "user",
      order: 10,
      permissionId: "tasks.manage"
    }
  ],
  permissions: [
    {
      id: "tasks.view",
      label: "View tasks",
      description: "Read tasks owned by or shared with the active actor.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "tasks.create",
      label: "Create tasks",
      description: "Create tasks owned by the active actor.",
      scope: "user",
      actions: ["create"]
    },
    {
      id: "tasks.update",
      label: "Update tasks",
      description: "Update tasks owned by or shared with the active actor.",
      scope: "user",
      actions: ["update"]
    },
    {
      id: "tasks.manage",
      label: "Manage tasks module",
      description: "Manage Tasks module settings and behavior.",
      scope: "user",
      actions: ["manage"]
    }
  ],
  featureFlags: [
    {
      id: "tasks.module",
      label: "Tasks module",
      description: "Enables the built-in Tasks module surfaces and routes.",
      scope: "system",
      defaultEnabled: true
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/tasks",
      responseSchema: listTasksResponseSchema,
      permissionId: "tasks.view"
    },
    {
      method: "POST",
      path: "/api/tasks",
      requestSchema: createTaskRequestSchema,
      responseSchema: createTaskResponseSchema,
      permissionId: "tasks.create"
    },
    {
      method: "GET",
      path: "/api/tasks/:id",
      responseSchema: getTaskResponseSchema,
      permissionId: "tasks.view"
    },
    {
      method: "PATCH",
      path: "/api/tasks/:id",
      requestSchema: updateTaskRequestSchema,
      responseSchema: updateTaskResponseSchema,
      permissionId: "tasks.update"
    },
    {
      method: "POST",
      path: "/api/tasks/:id/activity",
      requestSchema: addTaskActivityRequestSchema,
      responseSchema: addTaskActivityResponseSchema,
      permissionId: "tasks.update"
    },
    {
      method: "POST",
      path: "/api/tasks/:id/deferred-status",
      requestSchema: deferredTaskStatusRequestSchema,
      responseSchema: deferredTaskStatusResponseSchema,
      permissionId: "tasks.update"
    },
    {
      method: "POST",
      path: "/api/tasks/:id/tags",
      requestSchema: assignTaskTagRequestSchema,
      responseSchema: assignTaskTagRouteSchema.response[200],
      permissionId: "tasks.update"
    },
    {
      method: "DELETE",
      path: "/api/tasks/:id/tags/:tagId",
      responseSchema: unassignTaskTagRouteSchema.response[200],
      permissionId: "tasks.update"
    },
    {
      method: "GET",
      path: "/api/tasks/lists",
      responseSchema: listTaskListsResponseSchema,
      permissionId: "tasks.view"
    },
    {
      method: "POST",
      path: "/api/tasks/lists",
      requestSchema: createTaskListRequestSchema,
      responseSchema: createTaskListResponseSchema,
      permissionId: "tasks.create"
    },
    {
      method: "PATCH",
      path: "/api/tasks/lists/:listId",
      requestSchema: renameTaskListRequestSchema,
      responseSchema: renameTaskListRouteSchema.response[200],
      permissionId: "tasks.update"
    },
    {
      method: "DELETE",
      path: "/api/tasks/lists/:listId",
      requestSchema: deleteTaskListRequestSchema,
      responseSchema: deleteTaskListRouteSchema.response[200],
      permissionId: "tasks.update"
    },
    {
      method: "GET",
      path: "/api/tasks/lists/:listId/tags",
      responseSchema: listTaskTagsResponseSchema,
      permissionId: "tasks.view"
    },
    {
      method: "POST",
      path: "/api/tasks/lists/:listId/tags",
      requestSchema: createTaskTagRequestSchema,
      responseSchema: createTaskTagResponseSchema,
      permissionId: "tasks.create"
    },
    {
      method: "PATCH",
      path: "/api/tasks/lists/:listId/tags/:tagId",
      requestSchema: renameTaskTagRequestSchema,
      responseSchema: renameTaskTagRouteSchema.response[200],
      permissionId: "tasks.update"
    },
    {
      method: "DELETE",
      path: "/api/tasks/lists/:listId/tags/:tagId",
      responseSchema: deleteTaskTagRouteSchema.response[200],
      permissionId: "tasks.update"
    },
    {
      method: "POST",
      path: "/api/tasks/:id/breakdown",
      requestSchema: breakdownTaskRequestSchema,
      responseSchema: breakdownTaskResponseSchema,
      permissionId: "tasks.update"
    },
    {
      method: "GET",
      path: "/api/tasks/focus",
      responseSchema: focusTasksResponseSchema,
      permissionId: "tasks.view"
    },
    {
      method: "GET",
      path: "/api/tasks/at-risk",
      responseSchema: atRiskTasksResponseSchema,
      permissionId: "tasks.view"
    },
    {
      method: "GET",
      path: "/api/tasks/overdue",
      responseSchema: overdueTasksResponseSchema,
      permissionId: "tasks.view"
    },
    {
      method: "GET",
      path: "/api/tasks/preferences",
      permissionId: "tasks.view"
    },
    {
      method: "PATCH",
      path: "/api/tasks/preferences",
      permissionId: "tasks.update"
    },
    {
      method: "GET",
      path: "/api/tasks/:id/subtasks",
      permissionId: "tasks.view"
    },
    {
      method: "GET",
      path: "/api/tasks/:id/activity",
      permissionId: "tasks.view"
    }
  ],
  jobs: [
    {
      queueName: TASKS_DEFERRED_STATUS_QUEUE,
      payloadSchema: deferredTaskStatusPayloadSchema,
      metadataOnly: true,
      permissionId: "tasks.update"
    }
  ],
  shareableResources: [
    {
      resourceType: "task",
      grantLevels: ["view", "contribute", "manage"]
    }
  ],
  assistantTools: [
    {
      name: "tasks.list",
      description:
        "List tasks visible to the actor. Optional filters: listId, tagId, status (todo|done|archived), priority (1–5 integer), dueBefore/dueAfter (ISO 8601 date strings), quadrant (do|schedule|delegate|eliminate — Eisenhower matrix).",
      permissionId: "tasks.view",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {
          listId: { type: "string" },
          tagId: { type: "string" },
          status: { type: "string", enum: ["todo", "done", "archived"] },
          priority: { type: "integer", minimum: 1, maximum: 5 },
          dueBefore: { type: "string" },
          dueAfter: { type: "string" },
          quadrant: { type: "string", enum: ["do", "schedule", "delegate", "eliminate"] }
        }
      },
      outputSchema: listTasksResponseSchema,
      execute: taskListExecute
    },
    {
      name: "tasks.get",
      description:
        "Get a specific task by ID, including its subtasks and up to 10 most recent activity entries.",
      permissionId: "tasks.view",
      risk: "read",
      inputSchema: {
        type: "object",
        required: ["taskId"],
        properties: {
          taskId: { type: "string" }
        }
      },
      execute: taskGetExecute
    },
    {
      name: "tasks.focus",
      description:
        "Get the focus list — the highest-priority tasks to work on today: overdue tasks plus at-risk tasks (Medium+ priority, due within 48 h or do-date past), ranked by priority, urgency, and effort.",
      permissionId: "tasks.view",
      risk: "read",
      inputSchema: { type: "object", properties: {} },
      outputSchema: focusTasksResponseSchema,
      execute: taskFocusExecute
    },
    {
      name: "tasks.atRisk",
      description:
        "Get tasks at risk of slipping: open, Medium+ priority, due within 48 hours or do-date passed, with no completed subtasks.",
      permissionId: "tasks.view",
      risk: "read",
      inputSchema: { type: "object", properties: {} },
      outputSchema: atRiskTasksResponseSchema,
      execute: taskAtRiskExecute
    },
    {
      name: "tasks.overdue",
      description:
        "Get all overdue tasks — open tasks whose due date is in the past, most overdue first.",
      permissionId: "tasks.view",
      risk: "read",
      inputSchema: { type: "object", properties: {} },
      outputSchema: overdueTasksResponseSchema,
      execute: taskOverdueExecute
    },
    {
      name: "tasks.listLists",
      description: "List all task lists owned by the actor, ordered by position then name.",
      permissionId: "tasks.view",
      risk: "read",
      inputSchema: { type: "object", properties: {} },
      outputSchema: listTaskListsResponseSchema,
      execute: taskListListsExecute
    },
    {
      name: "tasks.listTags",
      description: "List all tags in a given task list.",
      permissionId: "tasks.view",
      risk: "read",
      inputSchema: {
        type: "object",
        required: ["listId"],
        properties: {
          listId: { type: "string" }
        }
      },
      outputSchema: listTaskTagsResponseSchema,
      execute: taskListTagsExecute
    },
    {
      name: "tasks.activity",
      description: "Get the full activity stream for a task, in chronological order.",
      permissionId: "tasks.view",
      risk: "read",
      inputSchema: {
        type: "object",
        required: ["taskId"],
        properties: {
          taskId: { type: "string" }
        }
      },
      execute: taskActivityExecute
    },
    {
      name: "tasks.updateStatus",
      description: "Update the status of a task visible to the active actor.",
      permissionId: "tasks.update",
      risk: "write",
      inputSchema: {
        type: "object",
        required: ["taskId", "status"],
        properties: {
          taskId: { type: "string" },
          status: taskStatusSchema,
          idempotencyKey: { type: "string" }
        }
      },
      outputSchema: getTaskResponseSchema,
      execute: taskUpdateStatusExecute
    }
  ]
} satisfies JarvisModuleManifest;
