import { describe, expect, it } from "vitest";

import type { DataContextDb } from "@jarv1s/db";

import { collectCandidates } from "../../packages/news/src/compilation/candidates.js";

const db = {} as DataContextDb;
const now = new Date("2026-07-11T12:00:00.000Z");

function feed(items: { title: string; url: string; date?: string }[]): string {
  return `<?xml version="1.0"?><rss><channel>${items
    .map(
      (item) =>
        `<item><title>${item.title}</title><link>${item.url}</link>${
          item.date ? `<pubDate>${item.date}</pubDate>` : ""
        }</item>`
    )
    .join("")}</channel></rss>`;
}

function repo(overrides: Record<string, unknown> = {}) {
  return {
    listCustomSources: async () => [],
    listCustomTopics: async () => [],
    listExclusions: async () => [],
    readPolicyVerdict: async () => null,
    upsertPolicyVerdict: async () => undefined,
    list: async () => [],
    ...overrides
  };
}

const emptyCatalog: readonly never[] = [];

describe("collectCandidates", () => {
  it("never fetches an excluded source", async () => {
    let fetches = 0;
    const result = await collectCandidates(
      db,
      {
        fetch: async () => {
          fetches += 1;
          return { ok: false, reason: "network" };
        },
        search: { search: async () => ({ results: [] }) },
        ai: {
          fingerprint: async () => "fp",
          generateJson: async () => ({ ok: false, error: "provider_error" })
        },
        repo: repo({
          listCustomSources: async () => [
            {
              id: "source-1",
              label: "Excluded",
              canonicalDomain: "news.example.com",
              homepageUrl: "https://news.example.com",
              feedUrl: "https://news.example.com/feed.xml",
              retrievalMethod: "feed",
              validationStatus: "approved",
              healthStatus: "available",
              createdAt: now.toISOString()
            }
          ],
          listExclusions: async () => [
            { id: "ex-1", canonicalDomain: "example.com", createdAt: now.toISOString() }
          ]
        }),
        catalog: emptyCatalog
      },
      { now }
    );
    expect(fetches).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it("drops missing, invalid, and future timestamps and caps a source at 15", async () => {
    const valid = Array.from({ length: 18 }, (_, index) => ({
      title: `<b>Headline ${index} with enough detail</b>`,
      url: `https://example.com/story-${index}`,
      date: "Fri, 11 Jul 2026 11:00:00 GMT"
    }));
    const body = feed([
      ...valid,
      { title: "Missing date", url: "https://example.com/missing" },
      { title: "Invalid date", url: "https://example.com/invalid", date: "not-a-date" },
      { title: "Future date", url: "https://example.com/future", date: "2026-07-11T14:00:00Z" }
    ]);
    const result = await collectCandidates(
      db,
      {
        fetch: async (url) => ({
          ok: true,
          status: 200,
          finalUrl: url,
          contentType: "application/rss+xml",
          body,
          truncated: false
        }),
        search: { search: async () => ({ results: [] }) },
        ai: {
          fingerprint: async () => "fp",
          generateJson: async () => ({ ok: false, error: "provider_error" })
        },
        repo: repo({
          listCustomSources: async () => [
            {
              id: "source-1",
              label: "Example",
              canonicalDomain: "example.com",
              homepageUrl: "https://example.com",
              feedUrl: "https://example.com/feed.xml",
              retrievalMethod: "feed",
              validationStatus: "approved",
              healthStatus: "available",
              createdAt: now.toISOString()
            }
          ]
        }),
        catalog: emptyCatalog
      },
      { now }
    );
    expect(result.candidates).toHaveLength(15);
    expect(result.candidates.every((candidate) => candidate.headline.length <= 300)).toBe(true);
    expect(result.candidates.every((candidate) => candidate.publishedAt.endsWith("Z"))).toBe(true);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => `c${index + 1}`)
    );
  });

  it("default-denies stories from a topic-discovered publisher", async () => {
    const result = await collectCandidates(
      db,
      {
        fetch: async () => ({ ok: false, reason: "network" }),
        search: {
          search: async () => ({
            results: [
              {
                title: "A relevant and trustworthy headline",
                url: "https://neutral.example/story",
                snippet: "Public snippet",
                publishedAt: "2026-07-11T11:00:00Z"
              }
            ]
          })
        },
        ai: {
          fingerprint: async () => "fp",
          generateJson: async () => ({
            ok: true,
            object: { allowed: false, category: "news_publisher" }
          })
        },
        repo: repo({
          listCustomTopics: async () => [
            {
              id: "topic-1",
              label: "Watches",
              guidance: null,
              validationStatus: "approved",
              createdAt: now.toISOString()
            }
          ]
        }),
        catalog: emptyCatalog
      },
      { now }
    );
    expect(result.candidates).toEqual([]);
  });
});
