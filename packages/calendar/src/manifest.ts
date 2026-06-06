import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { getCalendarEventResponseSchema, listCalendarEventsResponseSchema } from "@jarv1s/shared";

export const CALENDAR_MODULE_ID = "calendar";
export const calendarModuleSqlMigrationDirectory = fileURLToPath(
  new URL("../sql", import.meta.url)
);

export const calendarModuleManifest = {
  id: CALENDAR_MODULE_ID,
  name: "Calendar",
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
    migrations: ["sql/0011_calendar_module.sql"],
    migrationDirectories: ["packages/calendar/sql"],
    ownedTables: ["app.calendar_events"]
  },
  navigation: [
    {
      id: "calendar",
      label: "Calendar",
      path: "/calendar",
      icon: "calendar-days",
      order: 35,
      permissionId: "calendar.view"
    }
  ],
  permissions: [
    {
      id: "calendar.view",
      label: "View calendar",
      description:
        "Read cached calendar events owned by the actor or visible in the active joined workspace.",
      scope: "workspace",
      actions: ["view"]
    },
    {
      id: "calendar.manage",
      label: "Manage calendar module",
      description: "Manage Calendar module settings and connector-backed cache behavior.",
      scope: "workspace",
      actions: ["manage"]
    }
  ],
  featureFlags: [
    {
      id: "calendar.module",
      label: "Calendar module",
      description: "Enables the built-in connector-backed Calendar read surface.",
      scope: "system",
      defaultEnabled: true
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/calendar/events",
      responseSchema: listCalendarEventsResponseSchema,
      permissionId: "calendar.view"
    },
    {
      method: "GET",
      path: "/api/calendar/events/:id",
      responseSchema: getCalendarEventResponseSchema,
      permissionId: "calendar.view"
    }
  ],
  assistantTools: [
    {
      name: "calendar.listVisibleEvents",
      description: "List cached calendar events visible to the active actor and workspace context.",
      permissionId: "calendar.view",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {}
      },
      outputSchema: listCalendarEventsResponseSchema
    }
  ]
} satisfies JarvisModuleManifest;
