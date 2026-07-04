import { errorResponseSchema } from "./schema-fragments.js";

export const CALENDAR_AUTOMATION_MODES = ["off", "suggest", "auto"] as const;
export type CalendarAutomationMode = (typeof CALENDAR_AUTOMATION_MODES)[number];
export const DEFAULT_CALENDAR_SUGGESTION_MODE: CalendarAutomationMode = "suggest";
export const DEFAULT_CALENDAR_OFF_MODE: CalendarAutomationMode = "off";

export function parseCalendarAutomationMode(
  value: unknown,
  fallback: CalendarAutomationMode
): CalendarAutomationMode {
  return typeof value === "string" &&
    (CALENDAR_AUTOMATION_MODES as readonly string[]).includes(value)
    ? (value as CalendarAutomationMode)
    : fallback;
}

export interface CalendarBriefingSettingsDto {
  readonly lookaheadDays: 0 | 1 | 2;
  readonly prepTaskMode: CalendarAutomationMode;
  readonly timeBlockMode: CalendarAutomationMode;
  readonly commitmentMode: CalendarAutomationMode;
  readonly suggestTasks: boolean;
  readonly createTasks: boolean;
  readonly suggestTimeBlocks: boolean;
  readonly blockTime: boolean;
}

export interface GetCalendarBriefingSettingsResponse {
  readonly settings: CalendarBriefingSettingsDto;
}

export interface UpdateCalendarBriefingSettingsRequest {
  readonly lookaheadDays?: 0 | 1 | 2;
  readonly prepTaskMode?: CalendarAutomationMode;
  readonly timeBlockMode?: CalendarAutomationMode;
  readonly commitmentMode?: CalendarAutomationMode;
  readonly suggestTasks?: boolean;
  readonly createTasks?: boolean;
  readonly suggestTimeBlocks?: boolean;
  readonly blockTime?: boolean;
}

export interface UpdateCalendarBriefingSettingsResponse {
  readonly settings: CalendarBriefingSettingsDto;
}

export const calendarBriefingSettingsDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "lookaheadDays",
    "prepTaskMode",
    "timeBlockMode",
    "commitmentMode",
    "suggestTasks",
    "createTasks",
    "suggestTimeBlocks",
    "blockTime"
  ],
  properties: {
    lookaheadDays: { type: "number", enum: [0, 1, 2] },
    prepTaskMode: { type: "string", enum: [...CALENDAR_AUTOMATION_MODES] },
    timeBlockMode: { type: "string", enum: [...CALENDAR_AUTOMATION_MODES] },
    commitmentMode: { type: "string", enum: [...CALENDAR_AUTOMATION_MODES] },
    suggestTasks: { type: "boolean" },
    createTasks: { type: "boolean" },
    suggestTimeBlocks: { type: "boolean" },
    blockTime: { type: "boolean" }
  }
} as const;

export const getCalendarBriefingSettingsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["settings"],
  properties: {
    settings: calendarBriefingSettingsDtoSchema
  }
} as const;

export const updateCalendarBriefingSettingsRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    lookaheadDays: { type: "number", enum: [0, 1, 2] },
    prepTaskMode: { type: "string", enum: [...CALENDAR_AUTOMATION_MODES] },
    timeBlockMode: { type: "string", enum: [...CALENDAR_AUTOMATION_MODES] },
    commitmentMode: { type: "string", enum: [...CALENDAR_AUTOMATION_MODES] },
    suggestTasks: { type: "boolean" },
    createTasks: { type: "boolean" },
    suggestTimeBlocks: { type: "boolean" },
    blockTime: { type: "boolean" }
  }
} as const;

export const getCalendarBriefingSettingsRouteSchema = {
  response: {
    200: getCalendarBriefingSettingsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const updateCalendarBriefingSettingsRouteSchema = {
  body: updateCalendarBriefingSettingsRequestSchema,
  response: {
    200: getCalendarBriefingSettingsResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;
