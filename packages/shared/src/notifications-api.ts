import { nullableStringSchema } from "./schema-fragments.js";

export interface NotificationDto {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly recipientUserId: string | null;
  readonly title: string;
  readonly body: string | null;
  readonly metadata: Record<string, unknown>;
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
  additionalProperties: true
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
