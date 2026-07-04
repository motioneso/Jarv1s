import type { FastifyInstance, FastifyRequest } from "fastify";

import { handleRouteError } from "@jarv1s/module-sdk";
import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import {
  listNotificationsRouteSchema,
  markAllNotificationsReadRouteSchema,
  markNotificationReadRouteSchema,
  type NotificationDto
} from "@jarv1s/shared";

import { projectNotificationMetadata } from "./metadata.js";
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

        // 404 covers BOTH "notification does not exist" AND "exists but RLS-invisible to
        // this actor" — intentionally indistinguishable so callers cannot probe for
        // existence. See the docblock on NotificationsRepository.markRead.
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

/**
 * Serialize a stored notification row into the client-facing DTO.
 *
 * `metadata` is re-projected here on the way out (Decision 3b). This is the single
 * output chokepoint: the REST GET route and the `notifications.listVisible` assistant
 * tool (tools.ts imports this function) both pass through it, so a backfill or producer
 * bug that wrote oversized / nested / oddly-keyed jsonb cannot reach either client
 * surface. Fastify's response schema is NOT relied on to strip fields — there is no
 * global `removeAdditional` AJV config and adding one is out of scope.
 */
export function serializeNotification(notification: NotificationWithReadState): NotificationDto {
  return {
    id: notification.id,
    moduleId: notification.module_id,
    actorUserId: notification.actor_user_id,
    recipientUserId: notification.recipient_user_id,
    title: notification.title,
    body: notification.body,
    metadata: projectNotificationMetadata(notification.metadata),
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
