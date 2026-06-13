import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  listNotificationsResponseSchema,
  markAllNotificationsReadResponseSchema,
  markNotificationReadResponseSchema
} from "@jarv1s/shared";

import { notificationsListVisibleExecute } from "./tools.js";

export const NOTIFICATIONS_MODULE_ID = "notifications";
export const notificationsModuleSqlMigrationDirectory = fileURLToPath(
  new URL("../sql", import.meta.url)
);

export const notificationsModuleManifest = {
  id: NOTIFICATIONS_MODULE_ID,
  name: "Notifications",
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
      "sql/0008_notifications_module.sql",
      "sql/0071_notifications_worker_insert_grant.sql"
    ],
    migrationDirectories: ["packages/notifications/sql"],
    ownedTables: ["app.notifications", "app.notification_reads"]
  },
  navigation: [
    {
      id: "notifications",
      label: "Notifications",
      path: "/notifications",
      icon: "bell",
      order: 30,
      permissionId: "notifications.view"
    }
  ],
  permissions: [
    {
      id: "notifications.view",
      label: "View notifications",
      description: "Read notifications delivered to the active actor.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "notifications.update",
      label: "Update notification read state",
      description: "Mark notifications read for the active actor.",
      scope: "user",
      actions: ["update"]
    },
    {
      id: "notifications.manage",
      label: "Manage notifications module",
      description: "Manage notification module settings and delivery behavior.",
      scope: "system",
      actions: ["manage"]
    }
  ],
  featureFlags: [
    {
      id: "notifications.module",
      label: "Notifications module",
      description: "Enables the built-in in-app Notifications module surfaces and routes.",
      scope: "system",
      defaultEnabled: true
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/notifications",
      responseSchema: listNotificationsResponseSchema,
      permissionId: "notifications.view"
    },
    {
      method: "PATCH",
      path: "/api/notifications/:id/read",
      responseSchema: markNotificationReadResponseSchema,
      permissionId: "notifications.update"
    },
    {
      method: "PATCH",
      path: "/api/notifications/read-all",
      responseSchema: markAllNotificationsReadResponseSchema,
      permissionId: "notifications.update"
    }
  ],
  assistantTools: [
    {
      name: "notifications.listVisible",
      description: "List notifications delivered to the active actor.",
      permissionId: "notifications.view",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {}
      },
      outputSchema: listNotificationsResponseSchema,
      execute: notificationsListVisibleExecute
    }
  ]
} satisfies JarvisModuleManifest;
