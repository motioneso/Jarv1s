import type { FastifyInstance, FastifyRequest } from "fastify";

import type { DatasetClient } from "@jarv1s/datasets";
import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import {
  createNewsPrefResponseSchema,
  createNewsSourceExclusionSchema,
  deleteNewsPrefResponseSchema,
  deleteNewsSourceExclusionSchema,
  getNewsPersonalizationSchema,
  newsCatalogResponseSchema,
  newsOverviewResponseSchema,
  newsPrefsResponseSchema,
  type CreateNewsPrefRequest,
  type CreateNewsSourceExclusionRequest,
  type GetNewsPersonalizationResponse,
  type NewsCustomSourceDto,
  type NewsCustomTopicDto,
  type NewsPrefDto,
  type NewsSnapshotMetaDto,
  type NewsSourceExclusionDto
} from "@jarv1s/shared";

import { NewsPrefsRepository } from "./repository.js";
import { NewsService, type NewsPrefsReader } from "./news-service.js";
import { normalizePublisherDomain } from "./personalization-domain.js";
import {
  NewsPersonalizationLimitError,
  NewsPersonalizationRepository,
  type NewsSnapshotRecord
} from "./personalization-repository.js";
import { sourceEntry, topicOption } from "./source/catalog.js";

/**
 * The prefs persistence surface the routes need. `NewsPrefsRepository` satisfies it; tests
 * inject a fake. (`NewsService` only reads via `NewsPrefsReader`; the CRUD routes also write.)
 */
export interface NewsPrefsWriter extends NewsPrefsReader {
  create(scopedDb: DataContextDb, input: CreateNewsPrefRequest): Promise<NewsPrefDto>;
  remove(scopedDb: DataContextDb, id: string): Promise<boolean>;
}

/**
 * #953: capability availability the personalization GET reports. News receives booleans only —
 * the composition root builds these from the public AI/Settings APIs (resolveModelForCapability
 * for `json`, Brave-key config presence) so News never imports foreign internals and no key or
 * model identity crosses this seam.
 */
export interface NewsPersonalizationAvailabilityPort {
  hasJsonModel(scopedDb: DataContextDb): Promise<boolean>;
  hasWebSearch(scopedDb: DataContextDb): Promise<boolean>;
}

/** The personalization persistence surface the routes need (tests inject a fake). */
export interface NewsPersonalizationStore {
  listCustomSources(scopedDb: DataContextDb): Promise<NewsCustomSourceDto[]>;
  listCustomTopics(scopedDb: DataContextDb): Promise<NewsCustomTopicDto[]>;
  listExclusions(scopedDb: DataContextDb): Promise<NewsSourceExclusionDto[]>;
  createExclusion(
    scopedDb: DataContextDb,
    canonicalDomain: string
  ): Promise<NewsSourceExclusionDto>;
  removeExclusion(scopedDb: DataContextDb, id: string): Promise<boolean>;
  readLatestSnapshot(scopedDb: DataContextDb): Promise<NewsSnapshotRecord | null>;
}

export interface NewsRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  /**
   * The dataset-connector-SDK runtime client bound to the news module's `newsfeeds` external
   * source (composition root: packages/module-registry/src/index.ts).
   */
  readonly datasetClient: DatasetClient;
  /** #953: injected availability callbacks (see NewsPersonalizationAvailabilityPort). */
  readonly availability: NewsPersonalizationAvailabilityPort;
  /** Optional injection point for tests; defaults to a real `NewsPrefsRepository`. */
  readonly repository?: NewsPrefsWriter;
  /** Optional injection point for tests; defaults to a real `NewsPersonalizationRepository`. */
  readonly personalizationRepository?: NewsPersonalizationStore;
}

/**
 * Snapshot METADATA for the GET response. The payload jsonb never crosses this function's
 * return — only its article count. (The response schema would strip a leaked payload anyway;
 * not building it into the response object is the primary guard, the schema is defense-in-depth.)
 */
function toSnapshotMeta(record: NewsSnapshotRecord | null): NewsSnapshotMetaDto | null {
  if (!record) return null;
  const articles = (record.payload as { articles?: unknown }).articles;
  return {
    compiledAt: record.compiledAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    articleCount: Array.isArray(articles) ? articles.length : 0
  };
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
  const personalization: NewsPersonalizationStore =
    dependencies.personalizationRepository ?? new NewsPersonalizationRepository();
  const service = new NewsService({
    datasetClient: dependencies.datasetClient,
    dataContext: dependencies.dataContext,
    repository,
    personalization
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

  server.get(
    "/api/news/personalization",
    { schema: getNewsPersonalizationSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        // One DataContext window for all six reads; parallel awaits on one scopedDb is the
        // established repository pattern (see ai/repository.ts resolveModelForCapability).
        const result = await dependencies.dataContext.withDataContext(accessContext, async (db) => {
          const [customSources, customTopics, sourceExclusions, snapshot, jsonModel, webSearch] =
            await Promise.all([
              personalization.listCustomSources(db),
              personalization.listCustomTopics(db),
              personalization.listExclusions(db),
              personalization.readLatestSnapshot(db),
              dependencies.availability.hasJsonModel(db),
              dependencies.availability.hasWebSearch(db)
            ]);
          return { customSources, customTopics, sourceExclusions, snapshot, jsonModel, webSearch };
        });
        // Spec availability mapping: URL-based custom sources need only a JSON-capable model;
        // name-based sources and freeform topics additionally need web search to resolve/verify.
        const response: GetNewsPersonalizationResponse = {
          availability: {
            aiConfigured: result.jsonModel,
            webSearchConfigured: result.webSearch,
            customSourceByUrlEnabled: result.jsonModel,
            customSourceByNameEnabled: result.jsonModel && result.webSearch,
            freeformTopicsEnabled: result.jsonModel && result.webSearch
          },
          customSources: result.customSources,
          customTopics: result.customTopics,
          sourceExclusions: result.sourceExclusions,
          snapshot: toSnapshotMeta(result.snapshot)
        };
        return response;
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/news/source-exclusions",
    { schema: createNewsSourceExclusionSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = request.body as CreateNewsSourceExclusionRequest;
        const normalized = normalizePublisherDomain(input.source);
        if (!normalized.ok) {
          // Reason key only — never echo the raw submitted string back (or into logs).
          throw new HttpError(400, `Invalid publisher domain (${normalized.reason})`);
        }
        const exclusion = await dependencies.dataContext.withDataContext(
          accessContext,
          async (db) => {
            try {
              return await personalization.createExclusion(db, normalized.domain);
            } catch (error) {
              if (error instanceof NewsPersonalizationLimitError) {
                throw new HttpError(400, error.message);
              }
              throw error;
            }
          }
        );
        return { exclusion };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.delete(
    "/api/news/source-exclusions/:id",
    { schema: deleteNewsSourceExclusionSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { id } = request.params as { id: string };
        const ok = await dependencies.dataContext.withDataContext(accessContext, (db) =>
          personalization.removeExclusion(db, id)
        );
        return { ok };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}
