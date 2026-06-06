import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  addTaskActivityRequestSchema,
  addTaskActivityResponseSchema,
  createTaskRequestSchema,
  createTaskResponseSchema,
  deferredTaskStatusPayloadSchema,
  deferredTaskStatusRequestSchema,
  deferredTaskStatusResponseSchema,
  getTaskResponseSchema,
  listTasksResponseSchema,
  taskStatusSchema,
  updateTaskRequestSchema,
  updateTaskResponseSchema
} from "@jarv1s/shared";

export const TASKS_MODULE_ID = "tasks";
export const TASKS_DEFERRED_STATUS_QUEUE = "tasks-deferred-status";
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
    migrations: ["sql/0003_tasks_module.sql"],
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
      id: "tasks.workspace-settings",
      label: "Tasks",
      path: "/settings/modules/tasks",
      scope: "workspace",
      order: 10,
      permissionId: "tasks.manage"
    }
  ],
  permissions: [
    {
      id: "tasks.view",
      label: "View tasks",
      description:
        "Read tasks visible to the actor through ownership, grants, or workspace visibility.",
      scope: "workspace",
      actions: ["view"]
    },
    {
      id: "tasks.create",
      label: "Create tasks",
      description: "Create private tasks or workspace-visible tasks in joined workspaces.",
      scope: "workspace",
      actions: ["create"]
    },
    {
      id: "tasks.update",
      label: "Update tasks",
      description:
        "Update tasks the actor owns or can manage through grants or workspace membership.",
      scope: "workspace",
      actions: ["update"]
    },
    {
      id: "tasks.manage",
      label: "Manage tasks module",
      description: "Manage Tasks module settings and workspace-level task behavior.",
      scope: "workspace",
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
      name: "tasks.listVisible",
      description: "List tasks visible to the active actor and workspace context.",
      permissionId: "tasks.view",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {}
      },
      outputSchema: listTasksResponseSchema
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
      outputSchema: getTaskResponseSchema
    }
  ]
} satisfies JarvisModuleManifest;
