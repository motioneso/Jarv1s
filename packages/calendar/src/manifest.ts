import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  getCalendarBriefingSettingsResponseSchema,
  getCalendarEventResponseSchema,
  listCalendarEventsResponseSchema,
  updateCalendarBriefingSettingsRequestSchema
} from "@jarv1s/shared";

import {
  calendarListVisibleEventsExecute,
  calendarProposeFocusBlockExecute,
  summarizeProposeFocusBlock
} from "./tools.js";

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
    migrations: [
      "sql/0011_calendar_module.sql",
      "sql/0066_calendar_worker_grants_and_google_insert.sql",
      "sql/0087_calendar_events_update_connector_scope.sql",
      "sql/0113_worker_calendar_events_delete.sql"
    ],
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
  settings: [
    {
      id: "calendar.module-settings",
      label: "Calendar",
      path: "/settings/modules/calendar",
      scope: "user",
      order: 35,
      permissionId: "calendar.manage",
      entry: "./settings"
    }
  ],
  permissions: [
    {
      id: "calendar.view",
      label: "View calendar",
      description: "Read cached calendar events owned by or shared with the active actor.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "calendar.manage",
      label: "Manage calendar module",
      description: "Manage Calendar module settings and connector-backed cache behavior.",
      scope: "user",
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
  sourceBehaviors: [
    {
      id: "calendar",
      name: "Calendar",
      description:
        "What Jarvis is allowed to do with your calendar — independent of whichever service powers it.",
      behaviors: [
        {
          id: "calendar.briefings",
          name: "Include in briefings",
          description: "Surface today's events in the morning reading.",
          default: "default-on"
        },
        {
          id: "calendar.planning",
          name: "Use for planning",
          description: "Jarvis schedules its own focus blocks around your events.",
          default: "coming-soon"
        },
        {
          id: "calendar.detect-commitments",
          name: "Detect commitments",
          description: "Turn meeting language into a tracked commitment.",
          default: "coming-soon"
        },
        {
          id: "calendar.writeback",
          name: "Write events back",
          description: "Let Jarvis create and move calendar events for you.",
          default: "coming-soon"
        }
      ]
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
    },
    {
      method: "GET",
      path: "/api/calendar/briefing-settings",
      responseSchema: getCalendarBriefingSettingsResponseSchema,
      permissionId: "calendar.manage"
    },
    {
      method: "PATCH",
      path: "/api/calendar/briefing-settings",
      requestSchema: updateCalendarBriefingSettingsRequestSchema,
      responseSchema: getCalendarBriefingSettingsResponseSchema,
      permissionId: "calendar.manage"
    }
  ],
  assistantTools: [
    {
      name: "calendar.listVisibleEvents",
      description: "List cached calendar events owned by or shared with the active actor.",
      permissionId: "calendar.view",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {}
      },
      outputSchema: listCalendarEventsResponseSchema,
      execute: calendarListVisibleEventsExecute
    },
    {
      name: "calendar.proposeFocusBlock",
      description:
        "Propose and (on approval) create a focus-time block on the user's primary Google Calendar, conflict-checked live against their availability.",
      permissionId: "calendar.manage",
      risk: "write",
      requiresServices: ["calendarWrite"],
      // NOTE: the gateway's validateToolInput (input-validation.ts) enforces only type + enum +
      // required (NOT format/pattern/minimum/maximum/additionalProperties — see its docstring and
      // issue #133). So the `enum` below IS enforced. date/start FORMAT and duration BOUNDS are
      // enforced in the HANDLER: resolveWindow rejects a malformed start/date and clampDuration
      // bounds duration to 15..480 (Codex MED #5). Unknown extra keys are NOT rejected — readInput
      // simply ignores them, which is safe (only the known fields drive the write; an extra key
      // cannot change the resolved window). Descriptions document intent for a future ajv swap.
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", description: "local calendar date yyyy-mm-dd" },
          partOfDay: { type: "string", enum: ["morning", "afternoon", "evening"] },
          start: {
            type: "string",
            description: "explicit RFC3339 instant; if set, wins over date/partOfDay"
          },
          durationMinutes: {
            type: "number",
            description: "block length; clamped to 15..480 by the handler"
          },
          title: { type: "string", description: "block title; defaults to 'Focus time'" }
        }
      },
      execute: calendarProposeFocusBlockExecute,
      summarize: summarizeProposeFocusBlock
    }
  ]
} satisfies JarvisModuleManifest;
