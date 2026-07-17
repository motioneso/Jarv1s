import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { calendarMonitorProvider } from "./monitor-provider.js";
import {
  getCalendarBriefingSettingsResponseSchema,
  getCalendarEventResponseSchema,
  listCalendarEventsResponseSchema,
  updateCalendarBriefingSettingsRequestSchema,
  deleteCalendarEventResponseSchema
} from "@jarv1s/shared";

import {
  calendarListVisibleEventsExecute,
  calendarToolEventsOutputSchema,
  calendarProposeFocusBlockExecute,
  summarizeProposeFocusBlock,
  calendarDeleteEventExecute,
  summarizeDeleteEvent
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
      "sql/0113_worker_calendar_events_delete.sql",
      "sql/0126_app_runtime_calendar_events_delete.sql"
    ],
    migrationDirectories: ["packages/calendar/sql"],
    ownedTables: ["app.calendar_events"]
  },
  navigation: [
    {
      id: "calendar",
      label: "Calendar",
      description: "View the active actor's connected calendar events.",
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
      description: "Choose calendar briefing and scheduling preferences.",
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
  assistantActionFamilies: [
    {
      id: "calendar_writeback",
      label: "Calendar writeback",
      description: "Create Calendar-owned Jarvis blocks on the user's calendar.",
      defaultTier: "ask_each_time",
      allowedTiers: ["ask_each_time", "trusted_auto"]
    },
    {
      id: "calendar_management",
      label: "Delete calendar events",
      description: "Let Jarvis delete events from your calendar. Always asks first.",
      defaultTier: "always_confirm",
      allowedTiers: ["always_confirm"]
    }
  ],
  assistantTools: [
    {
      name: "calendar.listVisibleEvents",
      description:
        "List the actor's upcoming calendar events, read live from each connected account with " +
        "planning flags (conflict, early, late, has_location, prep_attendees); falls back to " +
        "cache only on transient provider failures, with source and gap metadata.",
      permissionId: "calendar.view",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {
          startsAfter: {
            type: "string",
            description: "ISO 8601 instant; window start (defaults to now)"
          },
          startsBefore: {
            type: "string",
            description: "ISO 8601 instant; window end (defaults to 48h after the window start)"
          },
          limit: {
            type: "number",
            description: "Maximum number of events to return (hard max 20 for cross-tool use)"
          }
        }
      },
      outputSchema: calendarToolEventsOutputSchema,
      execute: calendarListVisibleEventsExecute
    },
    {
      name: "calendar.proposeFocusBlock",
      description:
        "Propose and (on approval) create a focus-time block on the user's primary Google Calendar, conflict-checked live against their availability.",
      permissionId: "calendar.manage",
      risk: "write",
      executionPolicy: "auto",
      actionFamilyId: "calendar_writeback",
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
    },
    {
      name: "calendar.deleteEvent",
      description:
        "Delete a single calendar event the user owns. Always asks for confirmation; on approval " +
        "the event is removed from the user's Google Calendar (attendees are notified of the " +
        "cancellation). One event at a time; cannot delete recurring series.",
      permissionId: "calendar.manage",
      risk: "write",
      actionFamilyId: "calendar_management",
      // No executionPolicy: "auto" → gateway always confirms (belt 1). allowedTiers lock is belt 2.
      requiresServices: ["calendarWrite"],
      inputSchema: {
        type: "object",
        required: ["eventId"],
        properties: {
          eventId: {
            type: "string",
            description: "Jarvis calendar event id (uuid) from listVisibleEvents"
          },
          displayTitle: {
            type: "string",
            description: "Card preview only; the eventId is authoritative"
          },
          displayWhen: {
            type: "string",
            description: "Card preview only, e.g. 'Fri Jun 28, 14:00–15:00'"
          }
        }
      },
      outputSchema: deleteCalendarEventResponseSchema,
      execute: calendarDeleteEventExecute,
      summarize: summarizeDeleteEvent
    }
  ],
  proactiveMonitor: calendarMonitorProvider
} satisfies JarvisModuleManifest;
