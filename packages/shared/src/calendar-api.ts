export const CALENDAR_EVENT_VISIBILITIES = ["private", "workspace"] as const;

export type CalendarEventVisibility = (typeof CALENDAR_EVENT_VISIBILITIES)[number];

export interface CalendarEventDto {
  readonly id: string;
  readonly connectorAccountId: string;
  readonly ownerUserId: string;
  readonly workspaceId: string | null;
  readonly visibility: CalendarEventVisibility;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly location: string | null;
  readonly summary: string | null;
  readonly bodyExcerpt: string | null;
  readonly externalId: string;
  readonly externalMetadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListCalendarEventsResponse {
  readonly events: readonly CalendarEventDto[];
}

export interface GetCalendarEventResponse {
  readonly event: CalendarEventDto;
}

const nullableStringSchema = {
  anyOf: [{ type: "string" }, { type: "null" }]
} as const;

const jsonObjectSchema = {
  type: "object",
  additionalProperties: true
} as const;

const calendarEventParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string" }
  }
} as const;

export const calendarEventDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "connectorAccountId",
    "ownerUserId",
    "workspaceId",
    "visibility",
    "title",
    "startsAt",
    "endsAt",
    "location",
    "summary",
    "bodyExcerpt",
    "externalId",
    "externalMetadata",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    connectorAccountId: { type: "string" },
    ownerUserId: { type: "string" },
    workspaceId: nullableStringSchema,
    visibility: { type: "string", enum: CALENDAR_EVENT_VISIBILITIES },
    title: { type: "string" },
    startsAt: { type: "string" },
    endsAt: { type: "string" },
    location: nullableStringSchema,
    summary: nullableStringSchema,
    bodyExcerpt: nullableStringSchema,
    externalId: { type: "string" },
    externalMetadata: jsonObjectSchema,
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

export const listCalendarEventsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: calendarEventDtoSchema
    }
  }
} as const;

export const getCalendarEventResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["event"],
  properties: {
    event: calendarEventDtoSchema
  }
} as const;

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: { type: "string" }
  }
} as const;

export const listCalendarEventsRouteSchema = {
  response: {
    200: listCalendarEventsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const getCalendarEventRouteSchema = {
  params: calendarEventParamsSchema,
  response: {
    200: getCalendarEventResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;
