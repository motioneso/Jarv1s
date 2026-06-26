import type { FastifyInstance, FastifyRequest } from "fastify";

import { handleRouteError } from "@jarv1s/module-sdk";
import type { AccessContext, DataContextRunner, PreferencesPort } from "@jarv1s/db";
import {
  getCalendarBriefingSettingsRouteSchema,
  getCalendarEventRouteSchema,
  listCalendarEventsRouteSchema,
  type UpdateCalendarBriefingSettingsRequest,
  updateCalendarBriefingSettingsRouteSchema
} from "@jarv1s/shared";
import { PreferencesRepository } from "@jarv1s/structured-state";

import { CalendarRepository } from "./repository.js";
import { serializeCalendarEvent } from "./serialize.js";

const CALENDAR_BRIEFING_LOOKAHEAD_KEY = "calendar.briefing_lookahead_days";
const CALENDAR_SIGNAL_SUGGEST_TASKS_KEY = "calendar.signal_suggest_tasks";
const CALENDAR_SIGNAL_CREATE_TASKS_KEY = "calendar.signal_create_tasks";
const CALENDAR_SIGNAL_SUGGEST_TIME_BLOCKS_KEY = "calendar.signal_suggest_time_blocks";
const CALENDAR_SIGNAL_BLOCK_TIME_KEY = "calendar.signal_block_time";

export interface CalendarRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: CalendarRepository;
  readonly preferencesRepository?: PreferencesPort;
}

interface CalendarEventParams {
  readonly id: string;
}

export function registerCalendarRoutes(
  server: FastifyInstance,
  dependencies: CalendarRoutesDependencies
): void {
  const repository = dependencies.repository ?? new CalendarRepository();
  const preferencesRepository = dependencies.preferencesRepository ?? new PreferencesRepository();

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

  server.get(
    "/api/calendar/briefing-settings",
    { schema: getCalendarBriefingSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const settings = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => readCalendarBriefingSettings(scopedDb, preferencesRepository)
        );
        return { settings };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch(
    "/api/calendar/briefing-settings",
    { schema: updateCalendarBriefingSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as UpdateCalendarBriefingSettingsRequest;
        const settings = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            if (body.lookaheadDays !== undefined) {
              await preferencesRepository.upsert(
                scopedDb,
                CALENDAR_BRIEFING_LOOKAHEAD_KEY,
                body.lookaheadDays
              );
            }
            if (body.suggestTasks !== undefined) {
              await preferencesRepository.upsert(
                scopedDb,
                CALENDAR_SIGNAL_SUGGEST_TASKS_KEY,
                body.suggestTasks
              );
            }
            if (body.createTasks !== undefined) {
              await preferencesRepository.upsert(
                scopedDb,
                CALENDAR_SIGNAL_CREATE_TASKS_KEY,
                body.createTasks
              );
            }
            if (body.suggestTimeBlocks !== undefined) {
              await preferencesRepository.upsert(
                scopedDb,
                CALENDAR_SIGNAL_SUGGEST_TIME_BLOCKS_KEY,
                body.suggestTimeBlocks
              );
            }
            if (body.blockTime !== undefined) {
              await preferencesRepository.upsert(
                scopedDb,
                CALENDAR_SIGNAL_BLOCK_TIME_KEY,
                body.blockTime
              );
            }
            return readCalendarBriefingSettings(scopedDb, preferencesRepository);
          }
        );
        return { settings };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

async function readCalendarBriefingSettings(
  scopedDb: Parameters<PreferencesPort["get"]>[0],
  preferencesRepository: PreferencesPort
) {
  const [lookaheadDays, suggestTasks, createTasks, suggestTimeBlocks, blockTime] =
    await Promise.all([
      preferencesRepository.get(scopedDb, CALENDAR_BRIEFING_LOOKAHEAD_KEY),
      preferencesRepository.get(scopedDb, CALENDAR_SIGNAL_SUGGEST_TASKS_KEY),
      preferencesRepository.get(scopedDb, CALENDAR_SIGNAL_CREATE_TASKS_KEY),
      preferencesRepository.get(scopedDb, CALENDAR_SIGNAL_SUGGEST_TIME_BLOCKS_KEY),
      preferencesRepository.get(scopedDb, CALENDAR_SIGNAL_BLOCK_TIME_KEY)
    ]);

  return {
    lookaheadDays:
      lookaheadDays === 0 || lookaheadDays === 1 || lookaheadDays === 2 ? lookaheadDays : 2,
    suggestTasks: suggestTasks === false ? false : true,
    createTasks: createTasks === true,
    suggestTimeBlocks: suggestTimeBlocks === false ? false : true,
    blockTime: blockTime === true
  } as const;
}
