// tests/unit/job-search-excludes.test.ts
//
// Task 6 (#1290): pins what the hard-exclude filter is allowed to drop — exactly two
// reasons — and, more importantly, what it must NOT drop. Cases 2-4 assert postings that
// look like obvious excludes (wrong location, no salary, adjacent title) survive: that is
// the load-bearing behaviour, because stage 1 is where a plausible, well-meaning
// implementation would quietly delete the product's own recall.
import { describe, expect, it } from "vitest";

import { applyHardExcludes } from "../../external-modules/job-search/src/domain/excludes.js";
import type { Posting, SearchCriteria } from "../../external-modules/job-search/src/domain/records.js";

// Small Partial<>-override factories so each test states only the field it is about.
function posting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: "posting-1",
    sourceId: "linkedin",
    externalId: "ext-1",
    title: "Software Engineer",
    company: "Acme Corp",
    location: "Seattle, WA",
    url: "https://example.com/jobs/1",
    body: "",
    postedAt: null,
    ...overrides
  };
}

function criteria(overrides: Partial<SearchCriteria> = {}): SearchCriteria {
  return {
    titles: ["Software Engineer"],
    seniority: [],
    locations: ["Seattle, WA"],
    remote: "no-preference",
    compFloorCents: null,
    excludeCompanies: [],
    mustHave: [],
    niceToHave: [],
    dealbreakers: [],
    wantNarrative: "",
    ...overrides
  };
}

describe("job-search applyHardExcludes (#1290)", () => {
  it("drops a company on the exclude list, case- and whitespace-insensitively", () => {
    // Fails against a naive includes/exact-match implementation.
    const result = applyHardExcludes(
      [posting({ company: "  acme corp " })],
      criteria({ excludeCompanies: ["Acme Corp"] })
    );

    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toEqual([
      { posting: posting({ company: "  acme corp " }), reason: "excluded-company" }
    ]);
  });

  it("keeps a posting far from the stated location", () => {
    // This is the recall case the product exists to catch — the assertion is what stops a
    // later "obvious optimisation" from deleting it.
    const dublinPosting = posting({ location: "Dublin, Ireland" });
    const result = applyHardExcludes([dublinPosting], criteria({ locations: ["Seattle, WA"] }));

    expect(result.kept).toEqual([dublinPosting]);
    expect(result.dropped).toEqual([]);
  });

  it("keeps a posting with no salary listed, even under a high compensation floor", () => {
    // Posting carries no compensation field at all — the function has no way to see one,
    // let alone exclude on its absence. That structural absence is the guard for "never
    // exclude on a missing field": there is nothing here it could filter on even if it
    // wanted to.
    const noSalaryPosting = posting();
    const result = applyHardExcludes([noSalaryPosting], criteria({ compFloorCents: 300_000_00 }));

    expect(result.kept).toEqual([noSalaryPosting]);
    expect(result.dropped).toEqual([]);
  });

  it("keeps a posting whose title does not match the stated titles", () => {
    // The adjacent-title case: a title filter here would look correct in every demo and
    // quietly remove the best results.
    const adjacentTitlePosting = posting({ title: "Forward Deployed Engineer" });
    const result = applyHardExcludes([adjacentTitlePosting], criteria({ titles: ["Software Engineer"] }));

    expect(result.kept).toEqual([adjacentTitlePosting]);
    expect(result.dropped).toEqual([]);
  });

  it("collapses two postings sharing a URL to one, first-wins, normalised the same way", () => {
    const first = posting({ id: "posting-a", url: "https://example.com/jobs/1" });
    // Different case and trailing whitespace on the duplicate — proves the "normalised the
    // same way" constraint, not just an exact string match.
    const duplicate = posting({ id: "posting-b", url: " HTTPS://EXAMPLE.COM/jobs/1 " });

    const result = applyHardExcludes([first, duplicate], criteria());

    expect(result.kept).toEqual([first]);
    expect(result.dropped).toEqual([{ posting: duplicate, reason: "duplicate-url" }]);
  });

  it("preserves input order in kept and records every drop", () => {
    const keep1 = posting({ id: "keep-1", url: "https://example.com/jobs/1" });
    const excluded = posting({ id: "excluded-1", company: "Excluded Co", url: "https://example.com/jobs/2" });
    const keep2 = posting({ id: "keep-2", url: "https://example.com/jobs/3" });
    const dupe = posting({ id: "dupe-1", url: "https://example.com/jobs/1" });

    const result = applyHardExcludes(
      [keep1, excluded, keep2, dupe],
      criteria({ excludeCompanies: ["Excluded Co"] })
    );

    expect(result.kept).toEqual([keep1, keep2]);
    expect(result.dropped).toEqual([
      { posting: excluded, reason: "excluded-company" },
      { posting: dupe, reason: "duplicate-url" }
    ]);
  });
});
