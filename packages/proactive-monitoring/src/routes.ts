import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import { handleRouteError } from "@jarv1s/module-sdk";
import type { ProactiveSource } from "@jarv1s/shared";

import { CardRepository, serializeCard } from "./card-repository.js";
import { enqueueProactiveScan } from "./jobs.js";
import { ProactiveMonitoringPreferencesRepository } from "./preferences-repository.js";

export interface ProactiveMonitoringRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly boss: PgBoss;
  /** The set of sources that have a registered provider. Refresh only enqueues enabled+registered. */
  readonly registeredSources: ReadonlySet<ProactiveSource>;
  readonly cardRepository?: CardRepository;
  readonly preferencesRepository?: ProactiveMonitoringPreferencesRepository;
}

const MAX_CARDS_LIMIT = 20;

export function registerProactiveMonitoringRoutes(
  server: FastifyInstance,
  dependencies: ProactiveMonitoringRoutesDependencies
): void {
  const cardRepository = dependencies.cardRepository ?? new CardRepository();
  const prefsRepo =
    dependencies.preferencesRepository ?? new ProactiveMonitoringPreferencesRepository();

  server.get("/api/me/proactive-cards", async (request, reply) => {
    try {
      const ctx = await dependencies.resolveAccessContext(request);
      const query = request.query as { limit?: string };
      const limit = Math.min(
        parseInt(query.limit ?? "5", 10) || 5,
        MAX_CARDS_LIMIT
      );

      const cards = await dependencies.dataContext.withDataContext(ctx, (scopedDb) =>
        cardRepository.listActive(scopedDb, ctx.actorUserId, limit)
      );

      return reply.send({ cards: cards.map(serializeCard) });
    } catch (err) {
      return handleRouteError(err, reply);
    }
  });

  server.post("/api/me/proactive-cards/refresh", async (request, reply) => {
    try {
      const ctx = await dependencies.resolveAccessContext(request);
      const requestId = ctx.requestId;

      const pref = await dependencies.dataContext.withDataContext(ctx, (scopedDb) =>
        prefsRepo.get(scopedDb)
      );

      if (!pref.enabled) {
        return reply.status(202).send({ enqueued: 0 });
      }

      let enqueued = 0;
      const sources: ProactiveSource[] = ["tasks", "calendar", "email", "notes"];
      for (const source of sources) {
        if (!pref.sources[source]?.enabled) continue;
        if (!dependencies.registeredSources.has(source)) continue;

        const idempotencyKey = `manual-refresh:${ctx.actorUserId}:${source}:${requestId}`;
        await enqueueProactiveScan(
          dependencies.boss,
          ctx.actorUserId,
          source,
          "manual-refresh",
          idempotencyKey
        );
        enqueued++;
      }

      return reply.status(202).send({ enqueued });
    } catch (err) {
      return handleRouteError(err, reply);
    }
  });
}
