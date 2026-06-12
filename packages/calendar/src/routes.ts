import type { FastifyInstance, FastifyRequest } from "fastify";

import { handleRouteError } from "@jarv1s/module-sdk";
import type { AccessContext, CalendarEvent, DataContextRunner } from "@jarv1s/db";
import {
  getCalendarEventRouteSchema,
  listCalendarEventsRouteSchema,
  type CalendarEventDto
} from "@jarv1s/shared";

import { CalendarRepository } from "./repository.js";

export interface CalendarRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: CalendarRepository;
}

interface CalendarEventParams {
  readonly id: string;
}

export function registerCalendarRoutes(
  server: FastifyInstance,
  dependencies: CalendarRoutesDependencies
): void {
  const repository = dependencies.repository ?? new CalendarRepository();

  server.get(
    "/api/calendar/events",
    { schema: listCalendarEventsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const events = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listVisible(scopedDb)
        );

        return { events: events.map(serializeCalendarEvent) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: CalendarEventParams }>(
    "/api/calendar/events/:id",
    { schema: getCalendarEventRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const event = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.getById(scopedDb, request.params.id)
        );

        if (!event) {
          return reply.code(404).send({ error: "Calendar event not found" });
        }

        return { event: serializeCalendarEvent(event) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

export function serializeCalendarEvent(event: CalendarEvent): CalendarEventDto {
  return {
    id: event.id,
    connectorAccountId: event.connector_account_id,
    ownerUserId: event.owner_user_id,
    title: event.title,
    startsAt: toIsoString(event.starts_at),
    endsAt: toIsoString(event.ends_at),
    location: event.location,
    summary: event.summary,
    bodyExcerpt: event.body_excerpt,
    externalId: event.external_id,
    externalMetadata: event.external_metadata,
    createdAt: toIsoString(event.created_at),
    updatedAt: toIsoString(event.updated_at)
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
