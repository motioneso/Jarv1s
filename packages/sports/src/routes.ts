import type { FastifyInstance, FastifyRequest } from "fastify";

import type { DatasetClient } from "@jarv1s/datasets";
import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import {
  createSportsFollowResponseSchema,
  deleteSportsFollowResponseSchema,
  sportsCatalogResponseSchema,
  sportsFollowsResponseSchema,
  sportsLeagueTeamsResponseSchema,
  sportsOverviewResponseSchema,
  sportsStandingsResponseSchema,
  sportsTeamSearchResponseSchema,
  type CreateSportsFollowRequest,
  type SportsFollowDto
} from "@jarv1s/shared";

import { SportsFollowsRepository } from "./repository.js";
import { SportsService, type SportsFollowsReader } from "./sports-service.js";
import { catalogEntry } from "./source/catalog.js";

/**
 * The follows persistence surface the routes need. `SportsFollowsRepository`
 * satisfies it; tests inject a fake. (`SportsService` only reads via
 * `SportsFollowsReader`; the CRUD routes also write, so this widens it.)
 */
export interface SportsFollowsWriter extends SportsFollowsReader {
  create(scopedDb: DataContextDb, input: CreateSportsFollowRequest): Promise<SportsFollowDto>;
  remove(scopedDb: DataContextDb, id: string): Promise<boolean>;
}

export interface SportsRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  /**
   * The dataset-connector-SDK runtime client bound to the sports module's `espn` external
   * source (composition root: `packages/module-registry/src/index.ts`). Replaces the former
   * directly-injected `SportsSource`.
   */
  readonly datasetClient: DatasetClient;
  /** Optional injection point for tests; defaults to a real `SportsFollowsRepository`. */
  readonly repository?: SportsFollowsWriter;
  /** Clock seam forwarded to the service (default `() => new Date()`). */
  readonly now?: () => Date;
}

export function registerSportsRoutes(
  server: FastifyInstance,
  dependencies: SportsRoutesDependencies
): void {
  const repository: SportsFollowsWriter = dependencies.repository ?? new SportsFollowsRepository();
  const service = new SportsService({
    datasetClient: dependencies.datasetClient,
    dataContext: dependencies.dataContext,
    repository,
    now: dependencies.now
  });

  server.get(
    "/api/sports/catalog",
    { schema: sportsCatalogResponseSchema },
    async (request, reply) => {
      try {
        await dependencies.resolveAccessContext(request);
        return await service.getCatalog();
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/sports/leagues/:competitionKey/teams",
    { schema: sportsLeagueTeamsResponseSchema },
    async (request, reply) => {
      try {
        await dependencies.resolveAccessContext(request);
        const { competitionKey } = request.params as { competitionKey: string };
        // Same authorization-by-catalog rule as POST /follows: being in SPORTS_CATALOG is what
        // makes a competition queryable (#907).
        if (!catalogEntry(competitionKey)) {
          throw new HttpError(400, `Unknown competition: ${competitionKey}`);
        }
        return await service.getLeagueTeams(competitionKey);
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/sports/teams/search",
    { schema: sportsTeamSearchResponseSchema },
    async (request, reply) => {
      try {
        await dependencies.resolveAccessContext(request);
        const { q } = request.query as { q: string };
        return await service.searchTeams(q);
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/sports/overview",
    { schema: sportsOverviewResponseSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        return await service.getOverview(accessContext);
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/sports/standings",
    { schema: sportsStandingsResponseSchema },
    async (request, reply) => {
      try {
        await dependencies.resolveAccessContext(request);
        const { competitionKey } = request.query as { competitionKey: string };
        if (!catalogEntry(competitionKey)) {
          throw new HttpError(400, `Unknown competition: ${competitionKey}`);
        }
        const { group, fixtures } = await service.getStandings(competitionKey);
        return { group, fixtures };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/sports/follows",
    { schema: sportsFollowsResponseSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const follows = await dependencies.dataContext.withDataContext(accessContext, (db) =>
          repository.list(db)
        );
        return { follows };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/sports/follows",
    { schema: createSportsFollowResponseSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = request.body as CreateSportsFollowRequest;
        if (!catalogEntry(input.competitionKey)) {
          throw new HttpError(400, `Unknown competition: ${input.competitionKey}`);
        }
        const follow = await dependencies.dataContext.withDataContext(accessContext, (db) =>
          repository.create(db, input)
        );
        return { follow };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.delete(
    "/api/sports/follows/:id",
    { schema: deleteSportsFollowResponseSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { id } = request.params as { id: string };
        const ok = await dependencies.dataContext.withDataContext(accessContext, (db) =>
          repository.remove(db, id)
        );
        return { ok };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}
