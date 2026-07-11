import { describe, expect, it } from "vitest";

import {
  applyDeterministicFilters,
  type NewsCandidate
} from "../../packages/news/src/compilation/filters.js";

const now = new Date("2026-07-11T12:00:00.000Z");

function candidate(overrides: Partial<NewsCandidate> = {}): NewsCandidate {
  return {
    id: "c1",
    publisher: "Example",
    canonicalDomain: "example.com",
    headline: "A distinct useful headline",
    url: "https://example.com/story",
    publishedAt: "2026-07-11T11:00:00.000Z",
    excerpt: null,
    imageUrl: null,
    origin: "topic_search",
    matchedTopics: ["Watches"],
    ...overrides
  };
}

describe("applyDeterministicFilters", () => {
  it("drops excluded, unapproved, unsafe, future, and older-than-seven-day candidates", () => {
    const result = applyDeterministicFilters(
      [
        candidate({ id: "excluded", canonicalDomain: "sub.blocked.example" }),
        candidate({ id: "excluded-url", url: "https://sub.blocked.example/story" }),
        candidate({
          id: "unapproved",
          canonicalDomain: "unknown.example",
          url: "https://unknown.example/a"
        }),
        candidate({ id: "unsafe", url: "http://example.com/insecure" }),
        candidate({ id: "future", publishedAt: "2026-07-11T14:00:00Z" }),
        candidate({ id: "old", publishedAt: "2026-07-03T11:00:00Z" }),
        candidate({ id: "kept" })
      ],
      {
        exclusions: ["blocked.example"],
        approvedDomains: new Set(["example.com", "sub.blocked.example"]),
        now
      }
    );
    expect(result.map((item) => item.id)).toEqual(["kept"]);
  });

  it("allows three-day stories only for a sparse source", () => {
    const old = candidate({
      id: "old",
      origin: "preferred_source",
      publishedAt: "2026-07-08T12:00:00Z"
    });
    expect(
      applyDeterministicFilters([old], {
        exclusions: [],
        approvedDomains: new Set(["example.com"]),
        now
      }).map((item) => item.id)
    ).toEqual(["old"]);

    const recent = [1, 2, 3].map((id) =>
      candidate({
        id: `recent-${id}`,
        origin: "preferred_source",
        url: `https://example.com/${id}`,
        headline: `Distinct recent headline ${id}`
      })
    );
    expect(
      applyDeterministicFilters([old, ...recent], {
        exclusions: [],
        approvedDomains: new Set(["example.com"]),
        now
      }).map((item) => item.id)
    ).toEqual(recent.map((item) => item.id));
  });

  it("dedupes canonical URLs and normalized headlines in favor of preferred sources", () => {
    const result = applyDeterministicFilters(
      [
        candidate({
          id: "topic",
          url: "https://example.com/story?utm_source=x",
          headline: "Same headline!"
        }),
        candidate({
          id: "preferred",
          url: "https://example.com/story",
          headline: "same headline",
          origin: "preferred_source"
        })
      ],
      { exclusions: [], approvedDomains: new Set(["example.com"]), now }
    );
    expect(result.map((item) => item.id)).toEqual(["preferred"]);
  });
});
