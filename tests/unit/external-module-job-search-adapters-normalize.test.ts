// tests/unit/external-module-job-search-adapters-normalize.test.ts
//
// JS-04 (#933) Tasks 4-6: adapter normalize() against live-captured board
// fixtures (tests/fixtures/job-search/, provenance in its README). These pin
// that raw board payloads reduce to bounded plain-text postings: descriptions
// lose all markup (Greenhouse double-escapes its HTML), hostile or malformed
// items are SKIPPED and counted rather than trusted, canonical URLs must be
// https, and output is capped at MAX_POSTINGS_PER_FETCH.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ashbyAdapter } from "../../external-modules/job-search/src/adapters/ashby.js";
import { greenhouseAdapter } from "../../external-modules/job-search/src/adapters/greenhouse.js";
import { leverAdapter } from "../../external-modules/job-search/src/adapters/lever.js";
import {
  JobSearchFetchError,
  MAX_POSTINGS_PER_FETCH
} from "../../external-modules/job-search/src/adapters/types.js";

const FIXTURES = join(__dirname, "..", "fixtures", "job-search");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

describe("greenhouseAdapter", () => {
  const cfg = greenhouseAdapter.validateConfig({ board: "gitlab" });

  it("builds the pinned board API URL on an allow-listed host", () => {
    expect(greenhouseAdapter.buildUrl(cfg)).toBe(
      "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true"
    );
    for (const board of ["gitlab", "a1"]) {
      const url = new URL(greenhouseAdapter.buildUrl({ board }));
      expect(greenhouseAdapter.fetchHosts).toContain(url.hostname);
    }
  });

  it("declares allowed compliance with automated-review attribution", () => {
    expect(greenhouseAdapter.compliance.status).toBe("allowed");
    expect(greenhouseAdapter.compliance.reviewedBy).toBe("coordinator/automated");
  });

  it("normalizes the live fixture to plain-text postings", () => {
    const result = greenhouseAdapter.normalize(loadFixture("greenhouse-board.json"), cfg);
    expect(result.postings).toHaveLength(3);
    expect(result.skippedCount).toBe(0);

    const first = result.postings[0]!;
    expect(first.externalId).toBe("8503792002");
    expect(first.canonicalUrl).toBe("https://job-boards.greenhouse.io/gitlab/jobs/8503792002");
    expect(first.title).toBe("Account Executive - Italy");
    expect(first.company).toBe("gitlab"); // board token when no companyName given
    expect(first.locations).toEqual(["Remote, Italy", "Italy"]);
    expect(first.workMode).toBe("remote");
    expect(first.publishedAt).toBe("2026-04-17T09:58:03.000Z");
    expect(first.descriptionTruncated).toBe(false);
    // Greenhouse content is entity-ESCAPED HTML: decode + strip must leave
    // neither live markup nor residual escaped markup.
    expect(first.description.length).toBeGreaterThan(0);
    expect(first.description).not.toContain("<");
    expect(first.description).not.toContain("&lt;");
  });

  it("uses companyName over the board token when configured", () => {
    const named = greenhouseAdapter.validateConfig({ board: "gitlab", companyName: "GitLab" });
    const result = greenhouseAdapter.normalize(loadFixture("greenhouse-board.json"), named);
    expect(result.postings[0]!.company).toBe("GitLab");
  });

  it("throws malformed_payload for non-board shapes", () => {
    for (const payload of [{}, "x", null, { jobs: "nope" }]) {
      try {
        greenhouseAdapter.normalize(payload, cfg);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(JobSearchFetchError);
        expect((error as JobSearchFetchError).code).toBe("malformed_payload");
      }
    }
  });

  it("skips items missing required fields or carrying unsafe URLs", () => {
    const good = {
      id: 1,
      absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/1",
      title: "Good",
      content: "ok"
    };
    const payload = {
      jobs: [
        good,
        { ...good, id: undefined },
        { ...good, absolute_url: undefined },
        { ...good, title: undefined },
        { ...good, absolute_url: "javascript:alert(1)" },
        { ...good, absolute_url: "http://evil" },
        "not an object"
      ]
    };
    const result = greenhouseAdapter.normalize(payload, cfg);
    expect(result.postings).toHaveLength(1);
    expect(result.skippedCount).toBe(6);
  });

  it("caps output at MAX_POSTINGS_PER_FETCH and counts the remainder", () => {
    const jobs = Array.from({ length: MAX_POSTINGS_PER_FETCH + 5 }, (_, i) => ({
      id: i + 1,
      absolute_url: `https://job-boards.greenhouse.io/gitlab/jobs/${i + 1}`,
      title: `Role ${i + 1}`,
      content: "body"
    }));
    const result = greenhouseAdapter.normalize({ jobs }, cfg);
    expect(result.postings).toHaveLength(MAX_POSTINGS_PER_FETCH);
    expect(result.skippedCount).toBe(5);
  });
});

describe("leverAdapter", () => {
  const cfg = leverAdapter.validateConfig({ board: "leverdemo" });

  it("builds the pinned postings API URL and accepts board URLs", () => {
    expect(leverAdapter.buildUrl(cfg)).toBe("https://api.lever.co/v0/postings/leverdemo?mode=json");
    expect(new URL(leverAdapter.buildUrl(cfg)).hostname).toBe("api.lever.co");
    expect(leverAdapter.validateConfig({ url: "https://jobs.lever.co/leverdemo" })).toEqual({
      board: "leverdemo"
    });
    // Lever site names may carry hyphens and uppercase, unlike greenhouse.
    expect(leverAdapter.validateConfig({ board: "Lever-Demo" })).toEqual({ board: "Lever-Demo" });
  });

  it("declares allowed compliance with automated-review attribution", () => {
    expect(leverAdapter.compliance.status).toBe("allowed");
    expect(leverAdapter.compliance.reviewedBy).toBe("coordinator/automated");
  });

  it("normalizes the live fixture", () => {
    const result = leverAdapter.normalize(loadFixture("lever-postings.json"), cfg);
    expect(result.postings).toHaveLength(3);
    expect(result.skippedCount).toBe(0);

    const first = result.postings[0]!;
    expect(first.externalId).toBe("33538a2f-d27d-4a96-8f05-fa4b0e4d940e");
    expect(first.canonicalUrl).toBe(
      "https://jobs.lever.co/leverdemo/33538a2f-d27d-4a96-8f05-fa4b0e4d940e"
    );
    expect(first.company).toBe("leverdemo");
    expect(first.locations).toEqual(["Arlington, TX"]);
    expect(first.workMode).toBe("hybrid");
    expect(first.employmentType).toBe("Regular Full Time (Salary)");
    expect(first.compensation).toBeUndefined(); // salaryRange is null in fixture
    expect(first.publishedAt).toBe("2019-03-21T16:33:55.299Z"); // epoch-ms createdAt
    expect(first.description).not.toContain("<");
    expect(first.descriptionTruncated).toBe(false);

    // workplaceType "unspecified" (third posting) must not map to a mode.
    expect(result.postings[2]!.workMode).toBeUndefined();
  });

  it("formats compensation only for finite salary ranges", () => {
    const base = {
      id: "abc",
      hostedUrl: "https://jobs.lever.co/leverdemo/abc",
      text: "Role",
      description: "<p>body</p>"
    };
    const withSalary = {
      ...base,
      salaryRange: { min: 70_000, max: 90_000, currency: "USD", interval: "year" }
    };
    const result = leverAdapter.normalize([withSalary], cfg);
    expect(result.postings[0]!.compensation).toBe("70000–90000 USD per year");

    for (const salaryRange of [null, {}, { min: "70000", max: 90_000 }, { min: 1 }]) {
      const out = leverAdapter.normalize([{ ...base, salaryRange }], cfg);
      expect(out.postings[0]!.compensation).toBeUndefined();
    }
  });

  it("prefers descriptionPlain but still strips it, falling back to html description", () => {
    const base = { id: "abc", hostedUrl: "https://jobs.lever.co/leverdemo/abc", text: "Role" };
    const plain = leverAdapter.normalize(
      [{ ...base, descriptionPlain: "Plain <b>text</b>", description: "<p>ignored</p>" }],
      cfg
    );
    expect(plain.postings[0]!.description).toBe("Plain text");
    const fallback = leverAdapter.normalize([{ ...base, description: "<p>from html</p>" }], cfg);
    expect(fallback.postings[0]!.description).toBe("from html");
  });

  it("throws malformed_payload for non-array payloads and skips bad items", () => {
    for (const payload of [{}, "x", null, { postings: [] }]) {
      try {
        leverAdapter.normalize(payload, cfg);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(JobSearchFetchError);
        expect((error as JobSearchFetchError).code).toBe("malformed_payload");
      }
    }
    const good = { id: "ok", hostedUrl: "https://jobs.lever.co/leverdemo/ok", text: "Role" };
    const result = leverAdapter.normalize(
      [
        good,
        { ...good, id: 42 }, // lever ids are strings
        { ...good, hostedUrl: "http://evil" },
        { ...good, text: undefined },
        "not an object"
      ],
      cfg
    );
    expect(result.postings).toHaveLength(1);
    expect(result.skippedCount).toBe(4);
  });
});

describe("ashbyAdapter", () => {
  const cfg = ashbyAdapter.validateConfig({ board: "ramp" });

  it("builds the pinned posting-api URL and accepts board URLs and dotted names", () => {
    expect(ashbyAdapter.buildUrl(cfg)).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true"
    );
    expect(new URL(ashbyAdapter.buildUrl(cfg)).hostname).toBe("api.ashbyhq.com");
    expect(ashbyAdapter.validateConfig({ url: "https://jobs.ashbyhq.com/ramp" })).toEqual({
      board: "ramp"
    });
    // Ashby org names may contain dots (e.g. "acme.co"), unlike the other boards.
    expect(ashbyAdapter.validateConfig({ board: "acme.co" })).toEqual({ board: "acme.co" });
  });

  it("declares allowed compliance with automated-review attribution", () => {
    expect(ashbyAdapter.compliance.status).toBe("allowed");
    expect(ashbyAdapter.compliance.reviewedBy).toBe("coordinator/automated");
  });

  it("normalizes the live fixture", () => {
    const result = ashbyAdapter.normalize(loadFixture("ashby-job-board.json"), cfg);
    expect(result.postings).toHaveLength(3);
    expect(result.skippedCount).toBe(0);

    const first = result.postings[0]!;
    expect(first.externalId).toBe("03e2d4e1-73ad-4f09-a058-2eb9ce34c2bc");
    expect(first.canonicalUrl).toBe(
      "https://jobs.ashbyhq.com/ramp/03e2d4e1-73ad-4f09-a058-2eb9ce34c2bc"
    );
    expect(first.title).toBe("Technical Consultant, Mid-Market");
    expect(first.company).toBe("ramp");
    // Primary location + secondaryLocations[].location, deduped in order.
    expect(first.locations).toEqual(["Remote (US)", "San Francisco, CA", "New York, NY (HQ)"]);
    expect(first.workMode).toBe("remote");
    expect(first.employmentType).toBe("FullTime");
    expect(first.compensation).toBe("$151K – $231K • Offers Equity • Multiple Ranges");
    expect(first.publishedAt).toBe("2026-07-07T20:47:09.753Z");
    expect(first.description.length).toBeGreaterThan(0);
    expect(first.description).not.toContain("<");
    expect(first.descriptionTruncated).toBe(false);

    // isRemote wins over workplaceType: fixture job[1] is Hybrid but isRemote.
    expect(result.postings[1]!.workMode).toBe("remote");
  });

  it("skips unlisted postings instead of surfacing them", () => {
    const good = {
      id: "abc",
      jobUrl: "https://jobs.ashbyhq.com/ramp/abc",
      title: "Role",
      isListed: true,
      descriptionPlain: "body"
    };
    const result = ashbyAdapter.normalize(
      { jobs: [good, { ...good, id: "def", isListed: false }] },
      cfg
    );
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]!.externalId).toBe("abc");
    expect(result.skippedCount).toBe(1);
  });

  it("prefers descriptionPlain but still strips it, falling back to descriptionHtml", () => {
    const base = { id: "abc", jobUrl: "https://jobs.ashbyhq.com/ramp/abc", title: "Role" };
    const plain = ashbyAdapter.normalize(
      {
        jobs: [
          { ...base, descriptionPlain: "Plain <b>text</b>", descriptionHtml: "<p>ignored</p>" }
        ]
      },
      cfg
    );
    expect(plain.postings[0]!.description).toBe("Plain text");
    const fallback = ashbyAdapter.normalize(
      { jobs: [{ ...base, descriptionHtml: "<p>from html</p>" }] },
      cfg
    );
    expect(fallback.postings[0]!.description).toBe("from html");
  });

  it("throws malformed_payload for non-board shapes and skips bad items", () => {
    for (const payload of [{}, "x", null, { jobs: "nope" }]) {
      try {
        ashbyAdapter.normalize(payload, cfg);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(JobSearchFetchError);
        expect((error as JobSearchFetchError).code).toBe("malformed_payload");
      }
    }
    const good = {
      id: "ok",
      jobUrl: "https://jobs.ashbyhq.com/ramp/ok",
      title: "Role",
      descriptionPlain: "body"
    };
    const result = ashbyAdapter.normalize(
      {
        jobs: [
          good,
          { ...good, id: 42 }, // ashby ids are strings
          { ...good, jobUrl: "http://evil" },
          { ...good, title: undefined },
          "not an object"
        ]
      },
      cfg
    );
    expect(result.postings).toHaveLength(1);
    expect(result.skippedCount).toBe(4);
  });
});
