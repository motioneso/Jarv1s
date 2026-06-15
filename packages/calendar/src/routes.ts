import type { FastifyInstance, FastifyRequest } from "fastify";

import { handleRouteError } from "@jarv1s/module-sdk";
import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import {
  getCalendarEventRouteSchema,
  listCalendarEventsRouteSchema
} from "@jarv1s/shared";

import { CalendarRepository } from "./repository.js";
import { serializeCalendarEvent } from "./serialize.js";

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
