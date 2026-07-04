import { nullableStringSchema } from "./schema-fragments.js";

/**
 * A bounded primitive value permitted inside notification metadata.
 * Producers may only emit these JSON primitives; nested objects / arrays are dropped by
 * the projection helper (see `projectNotificationMetadata` in @jarv1s/notifications).
 */
export type NotificationMetadataValue = string | number | boolean | null;

/**
 * Bounded notification metadata: at most 16 keys (matching `^[a-zA-Z_][a-zA-Z0-9_]{0,63}$`),
 * each with a primitive value, total serialized size ≤ 4096 bytes, string values ≤ 256 chars.
 * The runtime projection (input + output) and the DB-level size CHECK (migration 0101)
 * enforce this contract; the schema below declares it honestly to clients.
 */
export type NotificationMetadata = Record<string, NotificationMetadataValue>;

export interface NotificationDto {
  readonly id: string;
  readonly moduleId: string | null;
  readonly actorUserId: string | null;
  readonly recipientUserId: string | null;
  readonly title: string;
  readonly body: string | null;
  readonly metadata: NotificationMetadata;
  readonly readAt: string | null;
  readonly createdAt: string | null;
}

export interface ListNotificationsResponse {
  readonly notifications: readonly NotificationDto[];
  readonly unreadCount: number;
}

export interface MarkNotificationReadResponse {
  readonly notification: NotificationDto;
}

export interface MarkAllNotificationsReadResponse {
  readonly unreadCount: number;
}

const metadataSchema = {
  type: "object",
  maxProperties: 16,
  additionalProperties: {
    anyOf: [
      { type: "string", maxLength: 256 },
      { type: "number" },
      { type: "boolean" },
      { type: "null" }
    ]
  },
  propertyNames: { pattern: "^[a-zA-Z_][a-zA-Z0-9_]{0,63}$" }
} as const;

export const notificationParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string" }
  }
} as const;

export const notificationDtoSchema = {
  type: "object",
  required: [
    "id",
    "moduleId",
    "actorUserId",
    "recipientUserId",
    "title",
    "body",
    "metadata",
    "readAt",
    "createdAt"
  ],
  properties: {
    id: { type: "string" },
    moduleId: nullableStringSchema,
    actorUserId: nullableStringSchema,
    recipientUserId: nullableStringSchema,
    title: { type: "string" },
    body: nullableStringSchema,
    metadata: metadataSchema,
    readAt: nullableStringSchema,
    createdAt: nullableStringSchema
  }
} as const;

export const listNotificationsResponseSchema = {
  type: "object",
  required: ["notifications", "unreadCount"],
  properties: {
    notifications: {
      type: "array",
      items: notificationDtoSchema
    },
    unreadCount: {
      type: "integer",
      minimum: 0
    }
  }
} as const;

export const markNotificationReadResponseSchema = {
  type: "object",
  required: ["notification"],
  properties: {
    notification: notificationDtoSchema
  }
} as const;

export const markAllNotificationsReadResponseSchema = {
  type: "object",
  required: ["unreadCount"],
  properties: {
    unreadCount: {
      type: "integer",
      minimum: 0
    }
  }
} as const;

export const listNotificationsRouteSchema = {
  response: {
    200: listNotificationsResponseSchema
  }
} as const;

export const markNotificationReadRouteSchema = {
  params: notificationParamsSchema,
  response: {
    200: markNotificationReadResponseSchema
  }
} as const;

export const markAllNotificationsReadRouteSchema = {
  response: {
    200: markAllNotificationsReadResponseSchema
  }
} as const;
