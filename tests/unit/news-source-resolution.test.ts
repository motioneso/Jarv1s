import { describe, expect, it, vi } from "vitest";

import type { DataContextDb } from "@jarv1s/db";

import type { NewsAiPort, NewsSafeFetchPort } from "../../packages/news/src/discovery/ports.js";
import { resolveSourceInput } from "../../packages/news/src/discovery/source-resolution.js";

const db = {} as DataContextDb;
const feed = `<rss><channel><item><title>A consequential headline today</title><link>https://one.example/story</link><pubDate>Fri, 11 Jul 2026 12:00:00 GMT</pubDate></item></channel></rss>`;

function ai(allowed = true): NewsAiPort {
  return {
    fingerprint: async () => "fp",
    generateJson: async () => ({
      ok: true,
      object: { allowed, category: "news_publisher" }
    })
  };
}

function repo(exclusions: string[] = []) {
  return {
    listExclusions: vi.fn(async () =>
      exclusions.map((canonicalDomain) => ({ id: canonicalDomain, canonicalDomain, createdAt: "" }))
    ),
    readPolicyVerdict: vi.fn(async () => null),
    upsertPolicyVerdict: vi.fn(async () => {})
  };
}

function fetchMap(entries: Record<string, { body: string; contentType?: string }>): NewsSafeFetchPort {
  return vi.fn(async (url: string) => {
    const entry = entries[url];
    return entry
      ? {
          ok: true as const,
          status: 200,
          finalUrl: url,
          contentType: entry.contentType ?? "text/html",
          body: entry.body,
          truncated: false
        }
      : { ok: false as const, reason: "network" as const };
  });
}

const noSearch = { search: vi.fn(async () => ({ results: [] })) };

describe("resolveSourceInput", () => {
  it("resolves a direct feed URL and carries validation evidence", async () => {
    const result = await resolveSourceInput(
      db,
      {
        fetch: fetchMap({
          "https://one.example/feed.xml": { body: feed, contentType: "application/rss+xml" }
        }),
        search: noSearch,
        ai: ai(),
        repo: repo()
      },
      { raw: "https://one.example/feed.xml", hasWebSearch: false }
    );
    expect(result).toMatchObject({
      status: "ok",
      candidates: [
        {
          canonicalDomain: "one.example",
          feedUrl: "https://one.example/feed.xml",
          retrievalMethod: "feed",
          sampleCount: 1,
          validationFingerprint: "fp"
        }
      ]
    });
  });

  it("discovers a homepage feed and falls back to listing headlines", async () => {
    const withFeed = await resolveSourceInput(
      db,
      {
        fetch: fetchMap({
          "https://one.example/": {
            body: `<title>One News</title><link rel="alternate" type="application/rss+xml" href="/feed.xml">`
          },
          "https://one.example/feed.xml": { body: feed, contentType: "application/rss+xml" }
        }),
        search: noSearch,
        ai: ai(),
        repo: repo()
      },
      { raw: "https://one.example", hasWebSearch: false }
    );
    expect(withFeed).toMatchObject({ status: "ok", candidates: [{ retrievalMethod: "feed" }] });

    const scraped = await resolveSourceInput(
      db,
      {
        fetch: fetchMap({
          "https://two.example/": {
            body: `<title>Two News</title><a href="/story">A sufficiently important headline today</a>`
          }
        }),
        search: noSearch,
        ai: ai(),
        repo: repo()
      },
      { raw: "https://two.example", hasWebSearch: false }
    );
    expect(scraped).toMatchObject({ status: "ok", candidates: [{ retrievalMethod: "scrape" }] });
  });

  it("turns an article canonical URL into its publisher homepage", async () => {
    const fetch = fetchMap({
      "https://one.example/article": {
        body: `<link rel="canonical" href="https://one.example/canonical-story">`
      },
      "https://one.example/": {
        body: `<title>One News</title><a href="/story">A sufficiently important headline today</a>`
      }
    });
    await expect(
      resolveSourceInput(
        db,
        { fetch, search: noSearch, ai: ai(), repo: repo() },
        { raw: "https://one.example/article", hasWebSearch: false }
      )
    ).resolves.toMatchObject({ status: "ok", candidates: [{ homepageUrl: "https://one.example/" }] });
    expect(fetch).toHaveBeenCalledWith("https://one.example/");
  });

  it("resolves names to at most three verified ambiguous publishers", async () => {
    const search = {
      search: vi.fn(async () => ({
        results: [
          { title: "One", url: "https://one.example/", snippet: "", publishedAt: "2026-07-11" },
          { title: "Two", url: "https://two.example/", snippet: "", publishedAt: "2026-07-11" }
        ]
      }))
    };
    const fetch = fetchMap({
      "https://one.example/": {
        body: `<title>One</title><a href="/story">A sufficiently important headline today</a>`
      },
      "https://two.example/": {
        body: `<title>Two</title><a href="/story">Another sufficiently important headline</a>`
      }
    });
    await expect(
      resolveSourceInput(db, { fetch, search, ai: ai(), repo: repo() }, { raw: "Daily News", hasWebSearch: true })
    ).resolves.toMatchObject({ status: "ambiguous", candidates: [{}, {}] });
  });

  it("fails closed without prerequisites, on exclusions, policy rejection, or fetch challenge", async () => {
    await expect(
      resolveSourceInput(db, { fetch: fetchMap({}), search: noSearch, ai: ai(), repo: repo() }, { raw: "Daily News", hasWebSearch: false })
    ).resolves.toEqual({ status: "unavailable" });

    const excludedFetch = fetchMap({});
    await expect(
      resolveSourceInput(db, { fetch: excludedFetch, search: noSearch, ai: ai(), repo: repo(["one.example"]) }, { raw: "https://one.example", hasWebSearch: false })
    ).resolves.toMatchObject({ status: "rejected" });
    expect(excludedFetch).not.toHaveBeenCalled();

    await expect(
      resolveSourceInput(
        db,
        {
          fetch: fetchMap({
            "https://one.example/": {
              body: `<a href="/story">A sufficiently important headline today</a>`
            }
          }),
          search: noSearch,
          ai: ai(false),
          repo: repo()
        },
        { raw: "https://one.example", hasWebSearch: false }
      )
    ).resolves.toMatchObject({ status: "rejected", reason: "policy" });

    const challenged: NewsSafeFetchPort = async () => ({
      ok: false,
      reason: "http_error",
      status: 403
    });
    await expect(
      resolveSourceInput(db, { fetch: challenged, search: noSearch, ai: ai(), repo: repo() }, { raw: "https://one.example", hasWebSearch: false })
    ).resolves.toMatchObject({ status: "rejected", reason: "unreachable" });
  });
});
