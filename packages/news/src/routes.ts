import type { FastifyInstance, FastifyRequest } from "fastify";

import type { DatasetClient } from "@jarv1s/datasets";
import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import {
  createNewsPrefResponseSchema,
  deleteNewsPrefResponseSchema,
  newsCatalogResponseSchema,
  newsOverviewResponseSchema,
  newsPrefsResponseSchema,
  type CreateNewsPrefRequest,
  type NewsPrefDto
} from "@jarv1s/shared";

import { NewsPrefsRepository } from "./repository.js";
import { NewsService, type NewsPrefsReader } from "./news-service.js";
import { sourceEntry, topicOption } from "./source/catalog.js";

/**
 * The prefs persistence surface the routes need. `NewsPrefsRepository` satisfies it; tests
 * inject a fake. (`NewsService` only reads via `NewsPrefsReader`; the CRUD routes also write.)
 */
export interface NewsPrefsWriter extends NewsPrefsReader {
  create(scopedDb: DataContextDb, input: CreateNewsPrefRequest): Promise<NewsPrefDto>;
  remove(scopedDb: DataContextDb, id: string): Promise<boolean>;
}

export interface NewsRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  /**
   * The dataset-connector-SDK runtime client bound to the news module's `newsfeeds` external
   * source (composition root: packages/module-registry/src/index.ts).
   */
  readonly datasetClient: DatasetClient;
  /** Optional injection point for tests; defaults to a real `NewsPrefsRepository`. */
  readonly repository?: NewsPrefsWriter;
}

/** POST /prefs key validation: the key must exist in the catalog for its kind. */
function isValidPrefKey(input: CreateNewsPrefRequest): boolean {
  if (input.kind === "topic") return topicOption(input.key) !== undefined;
  return sourceEntry(input.key) !== undefined;
}

export function registerNewsRoutes(
  server: FastifyInstance,
  dependencies: NewsRoutesDependencies
): void {
  const repository: NewsPrefsWriter = dependencies.repository ?? new NewsPrefsRepository();
  const service = new NewsService({
    datasetClient: dependencies.datasetClient,
    dataContext: dependencies.dataContext,
    repository
  });

  server.get("/api/news/catalog", { schema: newsCatalogResponseSchema }, async (request, reply) => {
    try {
      await dependencies.resolveAccessContext(request);
      return service.getCatalog();
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get(
    "/api/news/overview",
    { schema: newsOverviewResponseSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        return await service.getOverview(accessContext);
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get("/api/news/prefs", { schema: newsPrefsResponseSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const prefs = await dependencies.dataContext.withDataContext(accessContext, (db) =>
        repository.list(db)
      );
      return { prefs };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.post(
    "/api/news/prefs",
    { schema: createNewsPrefResponseSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = request.body as CreateNewsPrefRequest;
        if (!isValidPrefKey(input)) {
          throw new HttpError(
            400,
            `Unknown ${input.kind === "topic" ? "topic" : "source"}: ${input.key}`
          );
        }
        const pref = await dependencies.dataContext.withDataContext(accessContext, (db) =>
          repository.create(db, input)
        );
        return { pref };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.delete(
    "/api/news/prefs/:id",
    { schema: deleteNewsPrefResponseSchema },
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
