import type { FastifyInstance, FastifyRequest } from "fastify";

import { handleRouteError } from "@jarv1s/module-sdk";
import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import {
  listNotificationsRouteSchema,
  markAllNotificationsReadRouteSchema,
  markNotificationReadRouteSchema,
  type NotificationDto
} from "@jarv1s/shared";

import { NotificationsRepository, type NotificationWithReadState } from "./repository.js";

export interface NotificationsRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: NotificationsRepository;
}

interface NotificationParams {
  readonly id: string;
}

export function registerNotificationsRoutes(
  server: FastifyInstance,
  dependencies: NotificationsRoutesDependencies
): void {
  const repository = dependencies.repository ?? new NotificationsRepository();

  server.get(
    "/api/notifications",
    { schema: listNotificationsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const result = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listVisible(scopedDb)
        );

        return {
          notifications: result.notifications.map(serializeNotification),
          unreadCount: result.unreadCount
        };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch(
    "/api/notifications/read-all",
    { schema: markAllNotificationsReadRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const unreadCount = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.markAllRead(scopedDb)
        );

        return { unreadCount };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: NotificationParams }>(
    "/api/notifications/:id/read",
    { schema: markNotificationReadRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const notification = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.markRead(scopedDb, request.params.id)
        );

        if (!notification) {
          return reply.code(404).send({ error: "Notification not found" });
        }

        return { notification: serializeNotification(notification) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

export function serializeNotification(notification: NotificationWithReadState): NotificationDto {
  return {
    id: notification.id,
    actorUserId: notification.actor_user_id,
    recipientUserId: notification.recipient_user_id,
    title: notification.title,
    body: notification.body,
    metadata: notification.metadata,
    readAt: toIsoString(notification.read_at),
    createdAt: toIsoString(notification.created_at)
  };
}

function toIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}
