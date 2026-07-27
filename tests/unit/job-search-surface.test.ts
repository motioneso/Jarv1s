// tests/unit/job-search-surface.test.ts
//
// Task 10 (#1294): pins the exact strings `surface.ts` assembles for the board and the
// briefing. Exact equality on `detail` is deliberate (spec test 13) — it is the assertion
// that catches a blended "87% match" instead of the two independent axes (L9).
import { describe, expect, it } from "vitest";

import type { FailureCause, Match, Posting } from "../../external-modules/job-search/src/domain/records.js";
import { buildBriefingContribution, newMatchCount } from "../../external-modules/job-search/src/domain/surface.js";

function posting(overrides: Partial<Posting> & Pick<Posting, "id" | "title" | "company">): Posting {
  return {
    sourceId: "linkedin",
    externalId: "ext-1",
    location: "Remote",
    url: "https://example.com/job",
    body: "",
    postedAt: null,
    ...overrides
  };
}

function match(overrides: Partial<Match> & Pick<Match, "id" | "postingId">): Match {
  return {
    profileId: "profile-1",
    fit: null,
    want: null,
    fitReason: "",
    wantReason: "",
    outsideFrame: false,
    state: "new",
    scoredAt: null,
    ...overrides
  };
}

describe("job-search newMatchCount (#1294)", () => {
  it("counts only unseen scored matches", () => {
    const matches: Match[] = [
      match({ id: "m1", postingId: "p1", state: "new" }),
      match({ id: "m2", postingId: "p2", state: "new" }),
      match({ id: "m3", postingId: "p3", state: "seen" }),
      match({ id: "m4", postingId: "p4", state: "dismissed" }),
      match({ id: "m5", postingId: "p5", state: "unscored" })
    ];

    expect(newMatchCount(matches)).toBe(2);
  });
});

describe("job-search buildBriefingContribution (#1294)", () => {
  it("at detail 'count', there is a headline and no items", () => {
    const result = buildBriefingContribution({
      profiles: [
        {
          id: "profile-1",
          name: "Software Engineer",
          matches: [
            match({ id: "m1", postingId: "p1", state: "new" }),
            match({ id: "m2", postingId: "p2", state: "new" })
          ],
          postings: new Map([
            ["p1", posting({ id: "p1", title: "Staff Engineer", company: "Globex" })],
            ["p2", posting({ id: "p2", title: "Senior Engineer", company: "Initech" })]
          ])
        }
      ],
      detail: "count",
      degraded: []
    });

    expect(result.headline).toBe("2 new job matches in Software Engineer.");
    expect(result.items).toEqual([]);
  });

  it("at detail 'top', every item names both axes separately", () => {
    const result = buildBriefingContribution({
      profiles: [
        {
          id: "profile-1",
          name: "Software Engineer",
          matches: [match({ id: "m1", postingId: "p1", state: "new", fit: 82, want: 91 })],
          postings: new Map([["p1", posting({ id: "p1", title: "Staff Engineer", company: "Globex" })]])
        }
      ],
      detail: "top",
      degraded: []
    });

    expect(result.items[0]?.title).toBe("Staff Engineer at Globex");
    // Exact equality — the assertion that catches a blended "87% match" implementation.
    expect(result.items[0]?.detail).toBe("Fit 82 · Want 91");
  });

  it("an out-of-frame match is flagged", () => {
    const result = buildBriefingContribution({
      profiles: [
        {
          id: "profile-1",
          name: "Software Engineer",
          matches: [
            match({ id: "m1", postingId: "p1", state: "new", fit: 74, want: 88, outsideFrame: true })
          ],
          postings: new Map([["p1", posting({ id: "p1", title: "Recruiter Ops Lead", company: "Acme" })]])
        }
      ],
      detail: "top",
      degraded: []
    });

    expect(result.items[0]?.detail).toBe("Fit 74 · Want 88 · outside what you asked for");
  });

  it("a degraded portal is reported in the briefing rather than passed over in silence", () => {
    const cause: FailureCause = {
      kind: "rate_limited",
      sourceId: "linkedin",
      summary: "LinkedIn rate-limited us after 40 of about 120 postings. Retrying at 10:40.",
      retrieved: 40,
      expected: 120,
      lastOkAt: "2026-07-26T09:00:00.000Z",
      nextAction: "Retrying at 10:40.",
      retryAt: "2026-07-27T10:40:00.000Z",
      disabled: false
    };

    // Deliberately at the quietest detail level — the one the user is most likely to have
    // selected, and the one a silent-partial-crawl bug would most easily hide behind.
    const result = buildBriefingContribution({
      profiles: [
        {
          id: "profile-1",
          name: "Software Engineer",
          matches: [],
          postings: new Map()
        }
      ],
      detail: "count",
      degraded: [cause]
    });

    expect(result.items.some((item) => item.detail.includes(cause.summary))).toBe(true);
  });
});
