import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { DatasetClient, DatasetEnvelope } from "@jarv1s/datasets";
import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";
import type { CreateNewsPrefRequest, NewsPrefDto } from "@jarv1s/shared";

import { registerNewsRoutes, type NewsRoutesDependencies } from "../../packages/news/src/routes.js";
import type { RssFeedItem } from "../../packages/news/src/source/rss-source.js";

/**
 * Fake `DatasetClient` for the "feed" dataset, mirroring sports-routes.test.ts. Handler errors
 * are caught and reported degraded with the fallback (as the real `createDatasetClient` does).
 */
type FeedHandler = (sourceKey: string, topicKey: string | null) => Promise<RssFeedItem[]>;

function makeDatasetClient(getFeed: FeedHandler): DatasetClient {
  return {
    async getDataset<T>(
      datasetKey: string,
      params: Record<string, unknown>,
      options: { fallback: T }
    ): Promise<DatasetEnvelope<T>> {
      try {
        if (datasetKey !== "feed") throw new Error(`unknown dataset "${datasetKey}"`);
        const data = await getFeed(params.sourceKey as string, params.topicKey as string | null);
        return { data: data as T, degraded: false, fetchedAt: new Date().toISOString() };
      } catch {
        return { data: options.fallback, degraded: true, fetchedAt: new Date().toISOString() };
      }
    }
  };
}

const userA: AccessContext = {
  actorUserId: "00000000-0000-0000-0000-00000000000a",
  requestId: "req-a"
};

const SEEDED_TOPIC_PREF: NewsPrefDto = {
  id: "11111111-1111-1111-1111-111111111111",
  kind: "topic",
  key: "technology",
  createdAt: "2026-07-01T00:00:00.000Z"
};

function feedItem(overrides: Partial<RssFeedItem> = {}): RssFeedItem {
  return {
    id: "i-1",
    title: "Chips get smaller again",
    url: "https://example.com/chips",
    publishedAt: "2026-07-08T12:00:00.000Z",
    imageUrl: null,
    summary: "A dek about chips.",
    ...overrides
  };
}

interface FakeRepo {
  list(scopedDb: DataContextDb): Promise<NewsPrefDto[]>;
  create(scopedDb: DataContextDb, input: CreateNewsPrefRequest): Promise<NewsPrefDto>;
  remove(scopedDb: DataContextDb, id: string): Promise<boolean>;
  created: CreateNewsPrefRequest[];
  removed: string[];
}

function makeRepo(initial: NewsPrefDto[]): FakeRepo {
  const created: CreateNewsPrefRequest[] = [];
  const removed: string[] = [];
  return {
    created,
    removed,
    list: async () => initial,
    create: async (_db, input) => {
      created.push(input);
      return {
        id: "22222222-2222-2222-2222-222222222222",
        kind: input.kind,
        key: input.key,
        createdAt: "2026-07-08T00:00:00.000Z"
      };
    },
    remove: async (_db, id) => {
      removed.push(id);
      return true;
    }
  };
}

function buildApp(
  overrides: Partial<NewsRoutesDependencies> & { repo?: FakeRepo; getFeed?: FeedHandler } = {}
) {
  const repo = overrides.repo ?? makeRepo([SEEDED_TOPIC_PREF]);
  const app = Fastify();
  const deps: NewsRoutesDependencies = {
    datasetClient:
      overrides.datasetClient ?? makeDatasetClient(overrides.getFeed ?? (async () => [feedItem()])),
    dataContext: {
      withDataContext: async <T>(_ac: AccessContext, work: (db: DataContextDb) => Promise<T>) =>
        work({} as DataContextDb)
    } as unknown as DataContextRunner,
    resolveAccessContext: overrides.resolveAccessContext ?? (async () => userA),
    repository: repo
  };
  registerNewsRoutes(app, deps);
  return { app, repo };
}

describe("news routes (#897)", () => {
  it("GET /api/news/overview returns a composed 200 body with enrichment intact on the wire", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/news/overview" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // fast-json-stringify guard (recurring trap — #859/#885): a response schema with
    // additionalProperties:false silently DROPS any emitted field not declared in
    // packages/shared/src/news-api.ts. The seeded technology pref makes topicKey/topicLabel
    // non-null; assert they and enabledSources actually survive serialization via app.inject.
    expect(body.topStories[0]).toMatchObject({
      topicKey: "technology",
      topicLabel: "Technology",
      sourceKey: "bbc",
      sourceLabel: "BBC News"
    });
    expect(body.enabledSources).toEqual([
      { sourceKey: "bbc", label: "BBC News" },
      { sourceKey: "guardian", label: "The Guardian" },
      { sourceKey: "npr", label: "NPR" }
    ]);
    expect(body.activeTopics).toEqual(["technology"]);
    expect(body.degraded).toBe(false);
    expect(body.sourceGroups[0].homepageUrl).toBeDefined();
    await app.close();
  });

  it("carries degraded: true to the wire when a publisher fails", async () => {
    const { app } = buildApp({
      getFeed: async (sourceKey) => {
        if (sourceKey === "guardian") throw new Error("origin down");
        return [feedItem()];
      }
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/news/overview" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).degraded).toBe(true);
    await app.close();
  });

  it("GET /api/news/catalog returns all 8 sources with topic coverage", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/news/catalog" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sources).toHaveLength(8);
    expect(body.topics).toHaveLength(8);
    const bbc = body.sources.find((s: { sourceKey: string }) => s.sourceKey === "bbc");
    // Serialization guard: the settings pane disables topic chips per source off this array.
    expect(bbc.topics).toContain("technology");
    expect(bbc.defaultEnabled).toBe(true);
    await app.close();
  });

  it("GET /api/news/prefs returns the actor's rows", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/news/prefs" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).prefs).toEqual([SEEDED_TOPIC_PREF]);
    await app.close();
  });

  it("POST /api/news/prefs persists a valid source pref via the repository", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/news/prefs",
      payload: { kind: "source", key: "nytimes" }
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).pref).toMatchObject({ kind: "source", key: "nytimes" });
    expect(repo.created).toEqual([{ kind: "source", key: "nytimes" }]);
    await app.close();
  });

  it("POST /api/news/prefs persists a valid topic pref", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/news/prefs",
      payload: { kind: "topic", key: "world" }
    });
    expect(res.statusCode).toBe(200);
    expect(repo.created).toEqual([{ kind: "topic", key: "world" }]);
    await app.close();
  });

  it("POST /api/news/prefs rejects an unknown source key with 400", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/news/prefs",
      payload: { kind: "source", key: "made-up-outlet" }
    });
    expect(res.statusCode).toBe(400);
    expect(repo.created).toEqual([]);
    await app.close();
  });

  it("POST /api/news/prefs rejects an unknown topic key with 400", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/news/prefs",
      payload: { kind: "topic", key: "astrology" }
    });
    expect(res.statusCode).toBe(400);
    expect(repo.created).toEqual([]);
    await app.close();
  });

  it("POST /api/news/prefs rejects an invalid kind at the schema layer", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/news/prefs",
      payload: { kind: "banana", key: "bbc" }
    });
    expect(res.statusCode).toBe(400);
    expect(repo.created).toEqual([]);
    await app.close();
  });

  it("DELETE /api/news/prefs/:id removes and returns ok", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/news/prefs/11111111-1111-1111-1111-111111111111"
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(repo.removed).toEqual(["11111111-1111-1111-1111-111111111111"]);
    await app.close();
  });

  it("DELETE /api/news/prefs/:id rejects a non-uuid id with 400", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "DELETE", url: "/api/news/prefs/not-a-uuid" });
    expect(res.statusCode).toBe(400);
    expect(repo.removed).toEqual([]);
    await app.close();
  });

  it("maps an auth failure to 401", async () => {
    const { app } = buildApp({
      resolveAccessContext: async () => {
        throw new HttpError(401, "Session is missing or expired");
      }
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/news/overview" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
