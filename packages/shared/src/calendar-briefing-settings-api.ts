import { errorResponseSchema } from "./schema-fragments.js";

export interface CalendarBriefingSettingsDto {
  readonly lookaheadDays: 0 | 1 | 2;
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
  required: ["lookaheadDays", "suggestTasks", "createTasks", "suggestTimeBlocks", "blockTime"],
  properties: {
    lookaheadDays: { type: "number", enum: [0, 1, 2] },
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
