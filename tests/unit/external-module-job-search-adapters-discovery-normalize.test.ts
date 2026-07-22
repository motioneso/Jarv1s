// tests/unit/external-module-job-search-adapters-discovery-normalize.test.ts
//
// JS-10 (#1229): the freehire broad-discovery provider — buildRequests
// (outbound minimization, AC5) and normalize() against a live-captured fixture
// (tests/fixtures/job-search/freehire-search.json, provenance in its README).
// These pin the security-load-bearing behaviors specific to broad discovery:
//   - buildRequests emits ONLY q/limit/offset/sort/order/countries (+ coarse
//     work_mode); salary/company/locations/dealbreakers can never leak outbound;
//   - every posting takes externalId:"" so url-path identity (spec §6.6) hashes
//     the canonical url — and the employer's `utm_source=freehire.dev` tracking
//     param is stripped so a broad hit CONVERGES with the same posting seen via
//     a board watch (which stores the bare canonical);
//   - hostile/malformed items are skipped + counted, only an envelope violation
//     throws, and output is hard-capped at MAX_BROAD_POSTINGS_PER_RUN.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createFreehireProvider,
  freehireProvider
} from "../../external-modules/job-search/src/adapters/freehire.js";
import type { DiscoveryQuery } from "../../external-modules/job-search/src/adapters/discovery-types.js";
import {
  MAX_BROAD_POSTINGS_PER_RUN,
  MAX_BROAD_TITLE_REQUESTS
} from "../../external-modules/job-search/src/adapters/discovery-types.js";
import { JobSearchFetchError } from "../../external-modules/job-search/src/adapters/types.js";

const FIXTURES = join(__dirname, "..", "fixtures", "job-search");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

// Minimal valid query; individual tests override single facets.
const QUERY: DiscoveryQuery = {
  titles: ["Backend Engineer", "Staff Engineer"],
  locations: ["Berlin", "Remote"],
  country: "us",
  maxResults: MAX_BROAD_POSTINGS_PER_RUN
};

describe("freehireProvider metadata", () => {
  it("declares a keyless, allowed, attribution-free provider on freehire.dev", () => {
    expect(freehireProvider.id).toBe("freehire");
    expect(freehireProvider.displayName).toBe("Freehire");
    expect(freehireProvider.fetchHosts).toEqual(["freehire.dev"]);
    expect(freehireProvider.compliance.status).toBe("allowed");
    expect(freehireProvider.compliance.reviewedBy).toBe("coordinator/automated");
    // Keyless ATS-sourced canonical urls need no third-party label (spec §6.4).
    expect(freehireProvider.attribution).toBeUndefined();
  });

  it("derives fetchHosts from a self-hosted base url with no code change (spec §6.1)", () => {
    const selfHosted = createFreehireProvider("https://jobs.internal.example/");
    expect(selfHosted.fetchHosts).toEqual(["jobs.internal.example"]);
    const url = new URL(
      selfHosted.buildRequests({ titles: ["x"], locations: [], country: "us", maxResults: 10 })[0]!
        .url
    );
    expect(url.host).toBe("jobs.internal.example");
  });
});

describe("freehireProvider.buildRequests (outbound minimization / AC5)", () => {
  it("emits exactly the allowed param set — nothing else leaves the instance", () => {
    const requests = freehireProvider.buildRequests(QUERY);
    expect(requests).toHaveLength(2); // one GET per title
    const url = new URL(requests[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://freehire.dev/api/v1/jobs/search");
    // The ONLY params that cross the seam (order is stable for determinism).
    expect([...url.searchParams.keys()]).toEqual([
      "q",
      "limit",
      "offset",
      "sort",
      "order",
      "countries"
    ]);
    expect(url.searchParams.get("q")).toBe("Backend Engineer");
    expect(url.searchParams.get("limit")).toBe(String(MAX_BROAD_POSTINGS_PER_RUN));
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.get("sort")).toBe("posted_at");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("countries")).toBe("us");
    // Locations/salary/dealbreakers are gate-applied locally, never sent.
    expect(requests[0]!.url).not.toContain("Berlin");
    expect(requests[0]!.url).not.toContain("Remote");
    expect(requests[0]!.url.toLowerCase()).not.toContain("salary");
    expect(requests[0]!.url).not.toContain("work_mode");
  });

  it("adds the coarse work_mode=remote flag ONLY when the profile asks for remote", () => {
    const remote = freehireProvider.buildRequests({ ...QUERY, remote: true });
    expect(new URL(remote[0]!.url).searchParams.get("work_mode")).toBe("remote");
    // false / undefined must not add the flag.
    expect(
      new URL(freehireProvider.buildRequests({ ...QUERY, remote: false })[0]!.url).searchParams.has(
        "work_mode"
      )
    ).toBe(false);
    expect(
      new URL(freehireProvider.buildRequests(QUERY)[0]!.url).searchParams.has("work_mode")
    ).toBe(false);
  });

  it("caps the fan-out at MAX_BROAD_TITLE_REQUESTS and drops empty titles", () => {
    const many = freehireProvider.buildRequests({
      ...QUERY,
      titles: ["a", "b", "c", "d", "e"]
    });
    expect(many).toHaveLength(MAX_BROAD_TITLE_REQUESTS);

    const withBlanks = freehireProvider.buildRequests({ ...QUERY, titles: ["   ", "Real Role"] });
    expect(withBlanks).toHaveLength(1);
    expect(new URL(withBlanks[0]!.url).searchParams.get("q")).toBe("Real Role");
  });

  it("lowercases the country and clamps limit into [1, MAX_BROAD_POSTINGS_PER_RUN]", () => {
    expect(
      new URL(freehireProvider.buildRequests({ ...QUERY, country: "GB" })[0]!.url).searchParams.get(
        "countries"
      )
    ).toBe("gb");
    expect(
      new URL(
        freehireProvider.buildRequests({ ...QUERY, maxResults: 999 })[0]!.url
      ).searchParams.get("limit")
    ).toBe(String(MAX_BROAD_POSTINGS_PER_RUN));
    expect(
      new URL(freehireProvider.buildRequests({ ...QUERY, maxResults: 0 })[0]!.url).searchParams.get(
        "limit"
      )
    ).toBe("1");
  });
});

describe("freehireProvider.normalize (fixture)", () => {
  it("reduces the live envelope to url-identity plain-text postings", () => {
    const result = freehireProvider.normalize(loadFixture("freehire-search.json"));
    expect(result.postings).toHaveLength(3);
    expect(result.skippedCount).toBe(0);

    const first = result.postings[0]!;
    // externalId:"" forces url-path identity (spec §6.6).
    expect(first.externalId).toBe("");
    // utm_source stripped so it converges with the greenhouse board canonical.
    expect(first.canonicalUrl).toBe("https://job-boards.greenhouse.io/adyen/jobs/7684222");
    expect(first.title).toBe("Senior CI/CD Engineer");
    expect(first.company).toBe("Adyen");
    expect(first.locations).toEqual(["Chicago", "north_america", "us"]);
    expect(first.workMode).toBe("hybrid");
    expect(first.compensation).toBe("180000–243000 USD per year");
    expect(first.publishedAt).toBe("2026-07-22T03:11:24.000Z");
    // employment_type is absent in the live enrichment → undefined.
    expect(first.employmentType).toBeUndefined();
    // Description is inert plain text: no live OR escaped markup survives.
    expect(first.description.length).toBeGreaterThan(0);
    expect(first.description).not.toContain("<");
    expect(first.description).not.toContain("&lt;");

    // Second record carries no work_mode → mode omitted; url still stripped.
    expect(result.postings[1]!.workMode).toBeUndefined();
    expect(result.postings[1]!.canonicalUrl).toBe(
      "https://job-boards.greenhouse.io/adyen/jobs/6897762"
    );
  });
});

describe("freehireProvider.normalize (adversarial)", () => {
  const good = {
    url: "https://job-boards.greenhouse.io/adyen/jobs/1",
    title: "Role",
    company: "Adyen"
  };

  it("throws malformed_payload ONLY on envelope violations", () => {
    for (const payload of [{}, "x", null, 7, { data: "nope" }, { meta: {} }]) {
      try {
        freehireProvider.normalize(payload);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(JobSearchFetchError);
        expect((error as JobSearchFetchError).code).toBe("malformed_payload");
      }
    }
  });

  it("skips items missing required fields or carrying non-https urls", () => {
    const payload = {
      data: [
        good,
        { ...good, url: undefined },
        { ...good, url: "http://evil" },
        { ...good, url: "javascript:alert(1)" },
        { ...good, title: undefined },
        { ...good, company: undefined },
        "not an object"
      ],
      meta: {}
    };
    const result = freehireProvider.normalize(payload);
    expect(result.postings).toHaveLength(1);
    expect(result.skippedCount).toBe(6);
  });

  it("strips utm_* tracking params but preserves other query params", () => {
    const result = freehireProvider.normalize({
      data: [
        { ...good, url: "https://x.greenhouse.io/a/jobs/9?utm_source=freehire.dev&gh_src=abc" },
        { ...good, url: "https://x.greenhouse.io/a/jobs/9?utm_source=freehire.dev" }
      ],
      meta: {}
    });
    // Non-utm param survives; the identity url is otherwise the bare canonical.
    expect(result.postings[0]!.canonicalUrl).toBe("https://x.greenhouse.io/a/jobs/9?gh_src=abc");
    // Pure-utm query collapses to the bare canonical (the "?" is dropped).
    expect(result.postings[1]!.canonicalUrl).toBe("https://x.greenhouse.io/a/jobs/9");
  });

  it("hard-caps a hostile oversized envelope at MAX_BROAD_POSTINGS_PER_RUN", () => {
    const data = Array.from({ length: MAX_BROAD_POSTINGS_PER_RUN + 5 }, (_, i) => ({
      url: `https://job-boards.greenhouse.io/adyen/jobs/${i + 1}`,
      title: `Role ${i + 1}`,
      company: "Adyen"
    }));
    const result = freehireProvider.normalize({ data, meta: {} });
    expect(result.postings).toHaveLength(MAX_BROAD_POSTINGS_PER_RUN);
    expect(result.skippedCount).toBe(5);
  });
});
