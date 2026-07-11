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

import { greenhouseAdapter } from "../../external-modules/job-search/src/adapters/greenhouse.js";
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
