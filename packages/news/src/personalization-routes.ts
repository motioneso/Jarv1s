import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";

import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import {
  confirmNewsSourceSchema,
  createNewsSourceExclusionSchema,
  createNewsTopicSchema,
  deleteNewsCustomSourceSchema,
  deleteNewsSourceExclusionSchema,
  deleteNewsTopicSchema,
  getNewsPersonalizationSchema,
  previewNewsSourceSchema,
  triggerNewsRefreshSchema,
  updateNewsTopicSchema,
  type ConfirmNewsSourceRequest,
  type CreateNewsSourceExclusionRequest,
  type CreateNewsTopicRequest,
  type GetNewsPersonalizationResponse,
  type NewsCustomSourceDto,
  type NewsCustomTopicDto,
  type NewsRefreshStateDto,
  type NewsSourceExclusionDto,
  type NewsSourcePreviewRequest,
  type NewsSnapshotMetaDto,
  type UpdateNewsTopicRequest
} from "@jarv1s/shared";

import { resolveSourceInput } from "./discovery/source-resolution.js";
import { validateTopic } from "./discovery/policy-validation.js";
import type { NewsAiPort, NewsSafeFetchPort, NewsWebSearchPort } from "./discovery/ports.js";
import { createPreviewStore } from "./discovery/preview-store.js";
import { enqueueNewsRefresh } from "./jobs.js";
import { normalizePublisherDomain } from "./personalization-domain.js";
import {
  NewsDuplicateSourceError,
  NewsPersonalizationLimitError,
  type NewsSnapshotRecord
} from "./personalization-repository.js";

const SNAPSHOT_FRESH_MS = 30 * 60 * 1_000;

export interface NewsPersonalizationStore {
  listCustomSources(scopedDb: DataContextDb): Promise<NewsCustomSourceDto[]>;
  createCustomSource(
    scopedDb: DataContextDb,
    input: {
      label: string;
      canonicalDomain: string;
      homepageUrl: string;
      feedUrl: string | null;
      retrievalMethod: "feed" | "scrape";
      validationFingerprint: string;
    }
  ): Promise<NewsCustomSourceDto>;
  replaceCustomSource(
    scopedDb: DataContextDb,
    sourceId: string,
    input: {
      label: string;
      canonicalDomain: string;
      homepageUrl: string;
      feedUrl: string | null;
      retrievalMethod: "feed" | "scrape";
      validationFingerprint: string;
    }
  ): Promise<NewsCustomSourceDto | null>;
  deleteCustomSource(scopedDb: DataContextDb, sourceId: string): Promise<boolean>;
  listCustomTopics(scopedDb: DataContextDb): Promise<NewsCustomTopicDto[]>;
  createCustomTopic(
    scopedDb: DataContextDb,
    input: { label: string; guidance: string | null; validationFingerprint: string }
  ): Promise<NewsCustomTopicDto>;
  updateCustomTopic(
    scopedDb: DataContextDb,
    topicId: string,
    input: { label: string; guidance: string | null; validationFingerprint: string }
  ): Promise<NewsCustomTopicDto | null>;
  deleteCustomTopic(scopedDb: DataContextDb, topicId: string): Promise<boolean>;
  listExclusions(scopedDb: DataContextDb): Promise<NewsSourceExclusionDto[]>;
  createExclusion(scopedDb: DataContextDb, domain: string): Promise<NewsSourceExclusionDto>;
  removeExclusion(scopedDb: DataContextDb, id: string): Promise<boolean>;
  readLatestSnapshot(scopedDb: DataContextDb): Promise<NewsSnapshotRecord | null>;
  readRefreshState(scopedDb: DataContextDb): Promise<NewsRefreshStateDto>;
  bumpRefreshRequest(scopedDb: DataContextDb): Promise<number>;
  pruneSnapshotDomain(scopedDb: DataContextDb, domain: string): Promise<void>;
  readPolicyVerdict(
    scopedDb: DataContextDb,
    domain: string,
    fingerprint: string
  ): Promise<"approved" | "rejected" | null>;
  upsertPolicyVerdict(
    scopedDb: DataContextDb,
    input: {
      canonicalDomain: string;
      fingerprint: string;
      verdict: "approved" | "rejected";
      ttlMs: number;
    }
  ): Promise<void>;
}

interface PersonalizationRouteDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly availability: {
    hasJsonModel(scopedDb: DataContextDb): Promise<boolean>;
    hasWebSearch(scopedDb: DataContextDb): Promise<boolean>;
  };
  readonly discovery: {
    readonly fetch: NewsSafeFetchPort;
    readonly search: NewsWebSearchPort;
    readonly ai: NewsAiPort;
  };
  readonly boss: PgBoss | null;
  readonly repository: NewsPersonalizationStore;
}

function toSnapshotMeta(record: NewsSnapshotRecord | null): NewsSnapshotMetaDto | null {
  if (!record) return null;
  const articles = (record.payload as { articles?: unknown }).articles;
  return {
    compiledAt: record.compiledAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    articleCount: Array.isArray(articles) ? articles.length : 0
  };
}

function cleanTopic(input: { label: string; guidance?: string }): {
  label: string;
  guidance: string | null;
} {
  const label = input.label.trim();
  if (!label) throw new HttpError(400, "Topic label is required");
  return { label, guidance: input.guidance?.trim() || null };
}

function mapWriteError(error: unknown): never {
  if (error instanceof NewsPersonalizationLimitError) throw new HttpError(400, error.message);
  if (error instanceof NewsDuplicateSourceError) throw new HttpError(409, error.message);
  throw error;
}

export async function triggerNewsRefresh(
  scopedDb: DataContextDb,
  repository: Pick<NewsPersonalizationStore, "bumpRefreshRequest">,
  boss: PgBoss | null,
  actorUserId: string,
  afterBump?: () => Promise<void>
): Promise<boolean> {
  await repository.bumpRefreshRequest(scopedDb);
  await afterBump?.();
  return boss ? enqueueNewsRefresh(boss, actorUserId) : false;
}

export function registerNewsPersonalizationRoutes(
  server: FastifyInstance,
  dependencies: PersonalizationRouteDependencies
): void {
  const repository = dependencies.repository;
  const previews = createPreviewStore();

  server.get(
    "/api/news/personalization",
    { schema: getNewsPersonalizationSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        return await dependencies.dataContext.withDataContext(accessContext, async (db) => {
          const [customSources, customTopics, sourceExclusions, snapshot, jsonModel, webSearch] =
            await Promise.all([
              repository.listCustomSources(db),
              repository.listCustomTopics(db),
              repository.listExclusions(db),
              repository.readLatestSnapshot(db),
              dependencies.availability.hasJsonModel(db),
              dependencies.availability.hasWebSearch(db)
            ]);
          let refresh = await repository.readRefreshState(db);
          if (!snapshot || Date.now() - snapshot.compiledAt.getTime() > SNAPSHOT_FRESH_MS) {
            await triggerNewsRefresh(db, repository, dependencies.boss, accessContext.actorUserId);
            refresh = await repository.readRefreshState(db);
          }
          const response: GetNewsPersonalizationResponse = {
            availability: {
              aiConfigured: jsonModel,
              webSearchConfigured: webSearch,
              customSourceByUrlEnabled: jsonModel,
              customSourceByNameEnabled: jsonModel && webSearch,
              freeformTopicsEnabled: jsonModel && webSearch
            },
            customSources,
            customTopics,
            sourceExclusions,
            snapshot: toSnapshotMeta(snapshot),
            refresh
          };
          return response;
        });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/news/sources/preview",
    { schema: previewNewsSourceSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = request.body as NewsSourcePreviewRequest;
        return await dependencies.dataContext.withDataContext(accessContext, async (db) => {
          const [hasJsonModel, hasWebSearch] = await Promise.all([
            dependencies.availability.hasJsonModel(db),
            dependencies.availability.hasWebSearch(db)
          ]);
          if (!hasJsonModel) return { status: "unavailable" as const };
          const result = await resolveSourceInput(
            db,
            { ...dependencies.discovery, repo: repository },
            { raw: input.input, hasWebSearch }
          );
          if (result.status !== "ok" && result.status !== "ambiguous") return result;

          const confirmationId = previews.put({
            ownerUserId: accessContext.actorUserId,
            candidates: result.candidates,
            replaceSourceId: input.replaceSourceId ?? null,
            createdAt: Date.now()
          });
          const existing = input.replaceSourceId ? [] : await repository.listCustomSources(db);
          const duplicate = result.candidates
            .map((candidate) =>
              existing.find((source) => source.canonicalDomain === candidate.canonicalDomain)
            )
            .find(Boolean);
          return {
            status: result.status,
            confirmationId,
            candidates: result.candidates.map((candidate) => ({
              label: candidate.label,
              canonicalDomain: candidate.canonicalDomain,
              homepageUrl: candidate.homepageUrl,
              retrievalMethod: candidate.retrievalMethod,
              sampleCount: candidate.sampleCount
            })),
            candidateIds: result.candidates.map((candidate) => candidate.candidateId),
            ...(duplicate ? { duplicateOfSourceId: duplicate.id } : {})
          };
        });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post("/api/news/sources", { schema: confirmNewsSourceSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const input = request.body as ConfirmNewsSourceRequest;
      const source = await dependencies.dataContext.withDataContext(accessContext, async (db) => {
        const preview = previews.take(accessContext.actorUserId, input.confirmationId);
        if (!preview) throw new HttpError(409, "Source preview expired or was not found");
        if (preview.candidates.length > 1 && !input.candidateId) {
          throw new HttpError(400, "Choose a publisher candidate");
        }
        const candidate = input.candidateId
          ? preview.candidates.find((item) => item.candidateId === input.candidateId)
          : preview.candidates[0];
        if (!candidate) throw new HttpError(400, "Publisher candidate is invalid");
        try {
          const write = {
            label: candidate.label,
            canonicalDomain: candidate.canonicalDomain,
            homepageUrl: candidate.homepageUrl,
            feedUrl: candidate.feedUrl,
            retrievalMethod: candidate.retrievalMethod,
            validationFingerprint: candidate.validationFingerprint
          };
          const created = preview.replaceSourceId
            ? await repository.replaceCustomSource(db, preview.replaceSourceId, write)
            : await repository.createCustomSource(db, write);
          if (!created) throw new HttpError(409, "Source to replace was not found");
          await triggerNewsRefresh(db, repository, dependencies.boss, accessContext.actorUserId);
          return created;
        } catch (error) {
          return mapWriteError(error);
        }
      });
      reply.code(201);
      return { source };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.delete(
    "/api/news/sources/:id",
    { schema: deleteNewsCustomSourceSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { id } = request.params as { id: string };
        const deleted = await dependencies.dataContext.withDataContext(
          accessContext,
          async (db) => {
            const source = (await repository.listCustomSources(db)).find((item) => item.id === id);
            const removed = await repository.deleteCustomSource(db, id);
            if (removed && source) {
              await triggerNewsRefresh(
                db,
                repository,
                dependencies.boss,
                accessContext.actorUserId,
                () => repository.pruneSnapshotDomain(db, source.canonicalDomain)
              );
            }
            return removed;
          }
        );
        return { deleted };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post("/api/news/topics", { schema: createNewsTopicSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const input = cleanTopic(request.body as CreateNewsTopicRequest);
      const topic = await dependencies.dataContext.withDataContext(accessContext, async (db) => {
        if (!(await dependencies.availability.hasWebSearch(db))) {
          throw new HttpError(503, "Topic discovery requires web search");
        }
        const policy = await validateTopic(db, { ai: dependencies.discovery.ai }, input);
        if (policy.verdict === "unavailable")
          throw new HttpError(503, "Topic validation unavailable");
        if (policy.verdict === "rejected") throw new HttpError(422, "Topic is not allowed");
        try {
          const created = await repository.createCustomTopic(db, {
            ...input,
            validationFingerprint: policy.fingerprint
          });
          await triggerNewsRefresh(db, repository, dependencies.boss, accessContext.actorUserId);
          return created;
        } catch (error) {
          return mapWriteError(error);
        }
      });
      reply.code(201);
      return { topic };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.patch(
    "/api/news/topics/:id",
    { schema: updateNewsTopicSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { id } = request.params as { id: string };
        const update = request.body as UpdateNewsTopicRequest;
        const topic = await dependencies.dataContext.withDataContext(accessContext, async (db) => {
          const current = (await repository.listCustomTopics(db)).find((item) => item.id === id);
          if (!current) throw new HttpError(400, "Topic was not found");
          const input = cleanTopic({
            label: update.label ?? current.label,
            guidance: update.guidance ?? current.guidance ?? undefined
          });
          if (!(await dependencies.availability.hasWebSearch(db))) {
            throw new HttpError(503, "Topic discovery requires web search");
          }
          const policy = await validateTopic(db, { ai: dependencies.discovery.ai }, input);
          if (policy.verdict === "unavailable") {
            throw new HttpError(503, "Topic validation unavailable");
          }
          if (policy.verdict === "rejected") throw new HttpError(422, "Topic is not allowed");
          const changed = await repository.updateCustomTopic(db, id, {
            ...input,
            validationFingerprint: policy.fingerprint
          });
          if (!changed) throw new HttpError(400, "Topic was not found");
          await triggerNewsRefresh(db, repository, dependencies.boss, accessContext.actorUserId);
          return changed;
        });
        return { topic };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.delete(
    "/api/news/topics/:id",
    { schema: deleteNewsTopicSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { id } = request.params as { id: string };
        const deleted = await dependencies.dataContext.withDataContext(
          accessContext,
          async (db) => {
            const removed = await repository.deleteCustomTopic(db, id);
            if (removed) {
              await triggerNewsRefresh(
                db,
                repository,
                dependencies.boss,
                accessContext.actorUserId
              );
            }
            return removed;
          }
        );
        return { deleted };
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
          throw new HttpError(400, `Invalid publisher domain (${normalized.reason})`);
        }
        const exclusion = await dependencies.dataContext.withDataContext(
          accessContext,
          async (db) => {
            try {
              const created = await repository.createExclusion(db, normalized.domain);
              await triggerNewsRefresh(
                db,
                repository,
                dependencies.boss,
                accessContext.actorUserId,
                () => repository.pruneSnapshotDomain(db, normalized.domain)
              );
              return created;
            } catch (error) {
              return mapWriteError(error);
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
        const ok = await dependencies.dataContext.withDataContext(accessContext, async (db) => {
          const removed = await repository.removeExclusion(db, id);
          if (removed) {
            await triggerNewsRefresh(db, repository, dependencies.boss, accessContext.actorUserId);
          }
          return removed;
        });
        return { ok };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post("/api/news/refresh", { schema: triggerNewsRefreshSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      return await dependencies.dataContext.withDataContext(accessContext, async (db) => {
        const queued = await triggerNewsRefresh(
          db,
          repository,
          dependencies.boss,
          accessContext.actorUserId
        );
        const refresh = await repository.readRefreshState(db);
        return { queued, state: refresh.state };
      });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });
}
