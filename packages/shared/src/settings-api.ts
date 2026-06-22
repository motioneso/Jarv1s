import { errorResponseSchema } from "./schema-fragments.js";

export interface QuietHoursSettingsDto {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
  readonly timezone: string | null;
}

export interface GetQuietHoursSettingsResponse {
  readonly quietHours: QuietHoursSettingsDto;
}

export interface PutQuietHoursSettingsRequest {
  readonly quietHours: QuietHoursSettingsDto;
}

export type PutQuietHoursSettingsResponse = GetQuietHoursSettingsResponse;

const quietHoursSchema = {
  type: "object",
  additionalProperties: false,
  required: ["enabled", "start", "end", "timezone"],
  properties: {
    enabled: { type: "boolean" },
    start: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    end: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    timezone: { type: ["string", "null"], maxLength: 100 }
  }
} as const;

export const getQuietHoursSettingsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["quietHours"],
      properties: { quietHours: quietHoursSchema }
    },
    401: errorResponseSchema
  }
} as const;

export const putQuietHoursSettingsRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["quietHours"],
    properties: { quietHours: quietHoursSchema }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["quietHours"],
      properties: { quietHours: quietHoursSchema }
    },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;
