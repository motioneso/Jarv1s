import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";

import {
  NEWS_IMAGE_MAX_BYTES,
  registerNewsImageRoute
} from "../../packages/news/src/image-route.js";
import type { NewsImageFetchPort } from "../../packages/news/src/discovery/ports.js";
import type {
  NewsSnapshotArticle,
  NewsSnapshotPayload
} from "../../packages/news/src/personalization-domain.js";
import type { NewsSnapshotRecord } from "../../packages/news/src/personalization-repository.js";

const now = new Date("2026-07-11T12:00:00.000Z");
const user: AccessContext = { actorUserId: "user-a", requestId: "request-a" };
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const signatures = [
  ["image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 1])],
  ["image/png", png],
  ["image/webp", new TextEncoder().encode("RIFF1234WEBP")],
  ["image/gif", new TextEncoder().encode("GIF89a")]
] as const;

function article(
  id = "article-1",
  imageUrl: string | null = "https://images.example/lead.png",
  overrides: Partial<NewsSnapshotArticle> = {}
): NewsSnapshotArticle {
  return {
    id,
    publisher: "Example News",
    canonicalDomain: "example.com",
    headline: "A real headline",
    url: `https://example.com/${id}`,
    publishedAt: "2026-07-11T10:00:00.000Z",
    excerpt: null,
    imageUrl,
    topics: [],
    preferred: true,
    rank: 1,
    ...overrides
  };
}

function record(articles: NewsSnapshotArticle[]): NewsSnapshotRecord {
  return {
    compiledAt: new Date("2026-07-11T11:00:00.000Z"),
    expiresAt: new Date("2026-07-18T11:00:00.000Z"),
    payload: { articles } satisfies NewsSnapshotPayload
  };
}

function buildApp(input: {
  snapshot: () => NewsSnapshotRecord | null;
  fetchImage?: NewsImageFetchPort;
  resolveAccessContext?: () => Promise<AccessContext>;
}) {
  const app = Fastify();
  registerNewsImageRoute(app, {
    dataContext: {
      withDataContext: async <T>(
        _accessContext: AccessContext,
        work: (db: DataContextDb) => Promise<T>
      ) => work({} as DataContextDb)
    } as unknown as DataContextRunner,
    resolveAccessContext: input.resolveAccessContext ?? (async () => user),
    repository: { readLatestSnapshot: async () => input.snapshot() },
    fetchImage:
      input.fetchImage ??
      (async () => ({ ok: true as const, contentType: "image/png", body: png, truncated: false })),
    now: () => now
  });
  return app;
}

describe("news image route", () => {
  it("serves an authorized image with private nosniff headers and caches by URL", async () => {
    let fetches = 0;
    const app = buildApp({
      snapshot: () => record([article()]),
      fetchImage: async (_url, maxBytes) => {
        fetches += 1;
        expect(maxBytes).toBe(NEWS_IMAGE_MAX_BYTES);
        return { ok: true, contentType: "image/png; charset=binary", body: png, truncated: false };
      }
    });

    for (let index = 0; index < 2; index += 1) {
      const response = await app.inject({ method: "GET", url: "/api/news/images/article-1" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("image/png");
      expect(response.headers["cache-control"]).toBe("private, max-age=300");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect([...response.rawPayload]).toEqual([...png]);
    }
    expect(fetches).toBe(1);
    await app.close();
  });

  it.each(signatures)("serves validated %s bytes", async (contentType, body) => {
    const app = buildApp({
      snapshot: () => record([article()]),
      fetchImage: async () => ({ ok: true, contentType, body, truncated: false })
    });

    const response = await app.inject({ method: "GET", url: "/api/news/images/article-1" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(contentType);
    expect(response.rawPayload).toEqual(Buffer.from(body));
    await app.close();
  });

  it("evicts the oldest image after 32 entries", async () => {
    const articles = Array.from({ length: 33 }, (_, index) =>
      article(`article-${index}`, `https://images.example/${index}.png`, { rank: index + 1 })
    );
    let fetches = 0;
    const app = buildApp({
      snapshot: () => record(articles),
      fetchImage: async () => {
        fetches += 1;
        return { ok: true, contentType: "image/png", body: png, truncated: false };
      }
    });

    for (const candidate of articles) {
      expect(
        (await app.inject({ method: "GET", url: `/api/news/images/${candidate.id}` })).statusCode
      ).toBe(200);
    }
    await app.inject({ method: "GET", url: "/api/news/images/article-0" });

    expect(fetches).toBe(34);
    await app.close();
  });

  it("evicts the oldest image before cached bytes exceed 16 MiB", async () => {
    const articles = Array.from({ length: 9 }, (_, index) =>
      article(`article-${index}`, `https://images.example/${index}.png`, { rank: index + 1 })
    );
    const body = new Uint8Array(2 * 1024 * 1024);
    body.set(png.subarray(0, 8));
    let fetches = 0;
    const app = buildApp({
      snapshot: () => record(articles),
      fetchImage: async () => {
        fetches += 1;
        return { ok: true, contentType: "image/png", body, truncated: false };
      }
    });

    for (const candidate of articles) {
      expect(
        (await app.inject({ method: "GET", url: `/api/news/images/${candidate.id}` })).statusCode
      ).toBe(200);
    }
    await app.inject({ method: "GET", url: "/api/news/images/article-0" });

    expect(fetches).toBe(10);
    await app.close();
  });

  it("keys cached bytes by upstream URL, not a colliding article ID", async () => {
    let snapshot = record([article("same-id", "https://images.example/one.png")]);
    const fetched: string[] = [];
    const app = buildApp({
      snapshot: () => snapshot,
      fetchImage: async (url) => {
        fetched.push(url);
        return {
          ok: true,
          contentType: "image/png",
          body: Uint8Array.from([...png, url.endsWith("two.png") ? 2 : 1]),
          truncated: false
        };
      }
    });

    const first = await app.inject({ method: "GET", url: "/api/news/images/same-id" });
    snapshot = record([article("same-id", "https://images.example/two.png")]);
    const second = await app.inject({ method: "GET", url: "/api/news/images/same-id" });

    expect(fetched).toEqual(["https://images.example/one.png", "https://images.example/two.png"]);
    expect(second.rawPayload.at(-1)).toBe(2);
    expect(second.rawPayload).not.toEqual(first.rawPayload);
    await app.close();
  });

  it("fails closed on ambiguous IDs, expired/old articles, and absent images", async () => {
    const cases: Array<{ snapshot: NewsSnapshotRecord; articleId: string }> = [
      {
        snapshot: record([
          article("same-id", "https://images.example/one.png"),
          article("same-id", "https://images.example/two.png", { rank: 2 })
        ]),
        articleId: "same-id"
      },
      {
        snapshot: { ...record([article()]), expiresAt: new Date("2026-07-11T11:59:59.000Z") },
        articleId: "article-1"
      },
      { snapshot: record([article("article-1", null)]), articleId: "article-1" },
      {
        snapshot: record([
          article("article-1", undefined, { publishedAt: "2026-07-04T11:59:59.000Z" })
        ]),
        articleId: "article-1"
      }
    ];
    let fetches = 0;
    for (const testCase of cases) {
      const app = buildApp({
        snapshot: () => testCase.snapshot,
        fetchImage: async () => {
          fetches += 1;
          return { ok: true, contentType: "image/png", body: png, truncated: false };
        }
      });
      const response = await app.inject({
        method: "GET",
        url: `/api/news/images/${testCase.articleId}`
      });
      expect(response.statusCode).toBe(404);
      await app.close();
    }
    expect(fetches).toBe(0);
  });

  it("rejects truncation, unsupported types, and MIME-signature mismatches", async () => {
    const failures = [
      { ok: true as const, contentType: "image/png", body: png, truncated: true },
      {
        ok: true as const,
        contentType: "image/svg+xml",
        body: new TextEncoder().encode("<svg></svg>"),
        truncated: false
      },
      {
        ok: true as const,
        contentType: "image/jpeg",
        body: png,
        truncated: false
      },
      {
        ok: true as const,
        contentType: "image/png",
        body: new Uint8Array(NEWS_IMAGE_MAX_BYTES + 1),
        truncated: false
      }
    ];
    for (const failure of failures) {
      const app = buildApp({
        snapshot: () => record([article()]),
        fetchImage: async () => failure
      });
      const response = await app.inject({ method: "GET", url: "/api/news/images/article-1" });
      expect(response.statusCode).toBe(502);
      expect(response.body).not.toContain("images.example");
      await app.close();
    }
  });

  it("requires authentication", async () => {
    const app = buildApp({
      snapshot: () => record([article()]),
      resolveAccessContext: async () => {
        throw new HttpError(401, "Authentication required");
      }
    });
    const response = await app.inject({ method: "GET", url: "/api/news/images/article-1" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
