// tests/unit/job-search-adapter-linkedin.test.ts
//
// Task 12 (#1296): mirrors every freehire case (job-search-adapter-freehire.test.ts) against the
// LinkedIn guest fixture, plus the two cases that are the reason this adapter is not a copy: a
// 200-status auth-wall interstitial, and stopping on the first empty page rather than walking to
// PAGE_CAP against a source that reports no total and no next cursor.
//
// Every case that is not about the deadline passes a FAR_FUTURE deadline, so a slow CI box
// cannot turn an unrelated assertion into a flake.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { SearchCriteria } from "../../external-modules/job-search/src/domain/records.js";
import { linkedinPortal } from "../../external-modules/job-search/src/adapters/linkedin.js";
import type { FetchLike } from "../../external-modules/job-search/src/adapters/types.js";
import { PAGE_CAP, statusToKind } from "../../external-modules/job-search/src/adapters/types.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/job-search/linkedin-guest.html", import.meta.url)
);
const RAW_FIXTURE = readFileSync(FIXTURE_PATH, "utf8");

// Real captured-and-trimmed LinkedIn guest-jobs fragment (three postings), 2026-07-27,
// tracking-scrubbed. Card three deliberately has no benefits badge, so this one fixture also
// exercises the "no snippet text at all" branch of `body` without needing a second fixture.
function fixtureResponse() {
  return { ok: true, status: 200, text: async () => RAW_FIXTURE };
}

/** Builds one `<li>` card block with only the markers this adapter's regex extractor actually
 * reads (see linkedin.ts's field-by-field comments). Deliberately does not reproduce the real
 * fixture's surrounding noise (tracking attributes, layout wrapper divs, HTML comments) — the
 * point of this helper is a minimal, controllable card for the failure-path tests; the real
 * fixture (above) is what proves the extractor survives the actual page's mess. */
function card(opts: {
  id: string;
  title: string;
  company: string;
  location: string;
  date: string;
  benefits?: string;
}): string {
  const benefits = opts.benefits
    ? `<span class="job-posting-benefits__text">${opts.benefits}</span>`
    : "";
  return (
    `<li><div class="base-card" data-entity-urn="urn:li:jobPosting:${opts.id}">` +
    `<a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/${opts.id}"></a>` +
    `<h3 class="base-search-card__title">${opts.title}</h3>` +
    `<h4 class="base-search-card__subtitle"><a href="https://www.linkedin.com/company/x">${opts.company}</a></h4>` +
    `<span class="job-search-card__location">${opts.location}</span>` +
    benefits +
    `<time class="job-search-card__listdate" datetime="${opts.date}">1 day ago</time>` +
    `</div></li>`
  );
}

function pageHtml(cards: string[]): string {
  return `<!DOCTYPE html>\n${cards.join("\n")}`;
}

function pageResponse(cards: string[]) {
  return { ok: true, status: 200, text: async () => pageHtml(cards) };
}

// The confirmed real shape of a genuine end-of-results page (probed live, 2026-07-27): no cards,
// no `<html>`/`<head>` structure at all — just the doctype and a stray HTML comment. This is a
// well-formed empty page, not a parse failure (see linkedin.ts's `looksLikeEmptyResultsPage`).
const EMPTY_PAGE_BODY = "<!DOCTYPE html>\n\n<!---->  ";

function emptyPageResponse() {
  return { ok: true, status: 200, text: async () => EMPTY_PAGE_BODY };
}

// A synthetic sign-in interstitial. Not a live capture (see linkedin.ts's header comment) —
// forcing the real wall would mean deliberately hammering LinkedIn until it blocks this module's
// IP, which is not a proportionate way to verify one code path. Keyed on marker text documented
// as LinkedIn's own sign-in routing, flagged to the team lead as unverified against a real
// interstitial and worth a one-time manual spot-check.
const AUTH_WALL_BODY =
  "<!DOCTYPE html><html><head><title>Sign in to LinkedIn</title></head>" +
  "<body>Please sign in to LinkedIn to continue viewing this page.</body></html>";

function authWallResponse() {
  return { ok: true, status: 200, text: async () => AUTH_WALL_BODY };
}

const FAR_FUTURE = Date.now() + 1000 * 60 * 60 * 24 * 365;

function criteria(overrides: Partial<SearchCriteria> = {}): SearchCriteria {
  return {
    titles: ["platform engineer"],
    seniority: [],
    locations: [],
    remote: "required",
    compFloorCents: null,
    excludeCompanies: [],
    mustHave: [],
    niceToHave: [],
    dealbreakers: [],
    wantNarrative: "",
    ...overrides
  };
}

describe("linkedin adapter (#1296)", () => {
  it("case 1: maps the captured guest-jobs fragment onto Posting records", async () => {
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValueOnce(fixtureResponse())
      .mockResolvedValue(emptyPageResponse());

    const result = await linkedinPortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(result.failure).toBeNull();
    expect(result.postings).toHaveLength(3);
    for (const posting of result.postings) {
      expect(posting.id).toBe("");
      expect(posting.sourceId).toBe("linkedin");
      expect(posting.externalId.length).toBeGreaterThan(0);
      expect(posting.title.length).toBeGreaterThan(0);
      expect(posting.company.length).toBeGreaterThan(0);
      expect(posting.location.length).toBeGreaterThan(0);
      expect(posting.url.startsWith("https://")).toBe(true);
      // No cookies/tracking params survive the extraction — the fixture is committed and public.
      expect(posting.url).not.toContain("?");
    }
    // The real asymmetry vs. freehire (see linkedin.ts's header + Constraints in part 17): the
    // guest fragment carries no job description at all, only an optional "early applicant"
    // badge. Card three has none, so `body` legitimately comes back empty here — that is
    // correct, not a bug, and Task 8's triage has less signal from this source than freehire.
    const [first, , third] = result.postings;
    expect(first?.body).toBe("Be an early applicant");
    expect(third?.body).toBe("");
    expect(result.postings[0]?.title).toBe("Sr Staff Engineer, Compiler");
    expect(result.postings[0]?.company).toBe("Renesas Electronics");
    // HTML entities in source text must be decoded, not left as literal markup.
    expect(result.postings[1]?.title).toBe("Senior/Staff Engineer, R&D Efficiency Platform");
  });

  it("case 2: sends keywords and (when present) location, paginating via start", async () => {
    const fetch: FetchLike = vi.fn().mockResolvedValue(emptyPageResponse());

    await linkedinPortal.crawl({
      fetch,
      criteria: criteria({ titles: ["staff engineer"], locations: ["Remote"] }),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    const url = new URL(calledUrl);
    expect(url.hostname).toBe("www.linkedin.com");
    expect(url.pathname).toBe("/jobs-guest/jobs/api/seeMoreJobPostings/search");
    expect(url.searchParams.get("keywords")).toBe("staff engineer");
    expect(url.searchParams.get("location")).toBe("Remote");
    expect(url.searchParams.get("start")).toBe("0");
  });

  it("case 2b: omitting locations omits the location param entirely (probed live: optional)", async () => {
    const fetch: FetchLike = vi.fn().mockResolvedValue(emptyPageResponse());

    await linkedinPortal.crawl({
      fetch,
      criteria: criteria({ locations: [] }),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    const [calledUrl] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(new URL(calledUrl).searchParams.has("location")).toBe(false);
  });

  it("case 2c: searches each title on its own, with start reset per title", async () => {
    // Same defect freehire had: joined keywords ask for any of the words, so the seniority word
    // shared by every title dominates the ranking. And `start` is an offset into one query's
    // results — carried across queries it would open every title after the first partway in.
    const fetch: FetchLike = vi.fn().mockResolvedValue(emptyPageResponse());

    await linkedinPortal.crawl({
      fetch,
      criteria: criteria({ titles: ["Senior Product Designer", "Staff Product Designer"] }),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    const sent = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => {
      const url = new URL((call as [string])[0]);
      return [url.searchParams.get("keywords"), url.searchParams.get("start")];
    });
    expect(sent).toEqual([
      ["Senior Product Designer", "0"],
      ["Staff Product Designer", "0"]
    ]);
  });

  it("case 2d: the same posting under two titles is returned once", async () => {
    const one = [
      card({ id: "1", title: "A", company: "Acme", location: "Remote", date: "2026-07-01" })
    ];
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValueOnce(pageResponse(one))
      .mockResolvedValueOnce(emptyPageResponse())
      .mockResolvedValueOnce(pageResponse(one))
      .mockResolvedValue(emptyPageResponse());

    const result = await linkedinPortal.crawl({
      fetch,
      criteria: criteria({ titles: ["Senior Product Designer", "Staff Product Designer"] }),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(result.postings).toHaveLength(1);
  });

  it("case 3: 429 -> structured rate_limited, partial results kept", async () => {
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValueOnce(
        pageResponse([
          card({ id: "1", title: "A", company: "Acme", location: "Remote", date: "2026-07-01" }),
          card({ id: "2", title: "B", company: "Acme", location: "Remote", date: "2026-07-01" }),
          card({ id: "3", title: "C", company: "Acme", location: "Remote", date: "2026-07-01" })
        ])
      )
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "" });

    const result = await linkedinPortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: "2026-07-26T09:00:00.000Z",
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(result.postings).toHaveLength(3);
    expect(result.failure?.kind).toBe("rate_limited");
    expect(result.failure?.retrieved).toBe(3);
    expect(result.failure?.disabled).toBe(false);
  });

  it("case 4: 401/403 -> login_required and disables itself", async () => {
    for (const status of [401, 403]) {
      const fetch: FetchLike = vi
        .fn()
        .mockResolvedValue({ ok: false, status, text: async () => "" });

      const result = await linkedinPortal.crawl({
        fetch,
        criteria: criteria(),
        lastOkAt: null,
        now: "2026-07-27T12:00:00.000Z",
        deadlineAt: FAR_FUTURE
      });

      expect(result.postings).toHaveLength(0);
      expect(result.failure?.kind).toBe("login_required");
      expect(result.failure?.disabled).toBe(true);
      expect(result.failure?.retryAt).toBeNull();
    }
  });

  it("case 5: unrecognised body reports a parse failure rather than zero jobs", async () => {
    // Not the canonical empty-results shape (has real <html>/<head> structure) and has no cards
    // — a maintenance page or a changed layout would look like this, and it must never read as
    // "the search found nothing".
    const unrecognised =
      "<!DOCTYPE html><html><head><title>Maintenance</title></head><body>Back soon.</body></html>";
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => unrecognised });

    const result = await linkedinPortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(result.postings).toEqual([]);
    expect(result.failure?.kind).toBe("parse_failed");
    expect(result.failure?.disabled).toBe(false);
    expect(result.failure?.summary).toContain("LinkedIn");
  });

  it("case 5b: a card missing a required field is also a parse failure, not a blank posting", async () => {
    const brokenCard =
      '<li><div class="base-card" data-entity-urn="urn:li:jobPosting:9"></div></li>';
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => pageHtml([brokenCard]) });

    const result = await linkedinPortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(result.postings).toEqual([]);
    expect(result.failure?.kind).toBe("parse_failed");
  });

  it("case 6: a rejected fetch resolves to a network failure, not a rejected promise", async () => {
    const fetch: FetchLike = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    const result = await linkedinPortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(result.postings).toEqual([]);
    expect(result.failure?.kind).toBe("network");
    expect(result.failure?.disabled).toBe(false);
  });

  it("case 7: stops paging at PAGE_CAP against a source that never reports a total or next cursor", async () => {
    const neverEndingPage = pageHtml([
      card({ id: "99", title: "T", company: "C", location: "L", date: "2026-07-01" })
    ]);
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => neverEndingPage });

    const result = await linkedinPortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(fetch).toHaveBeenCalledTimes(PAGE_CAP);
    // Hitting the cap is a self-imposed boundary, not a failure — every page fetched succeeded.
    expect(result.failure).toBeNull();
  });

  it("case 8: deadline expires between pages -> returns what it has", async () => {
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValue(
        pageResponse([
          card({ id: "1", title: "A", company: "Acme", location: "Remote", date: "2026-07-01" }),
          card({ id: "2", title: "B", company: "Acme", location: "Remote", date: "2026-07-01" }),
          card({ id: "3", title: "C", company: "Acme", location: "Remote", date: "2026-07-01" })
        ])
      );
    let calls = 0;
    // First check (before page 0) passes; second check (before page 1) is past deadline.
    const clock = () => {
      calls += 1;
      return calls === 1 ? 0 : 1_000;
    };

    const result = await linkedinPortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: "2026-07-26T09:00:00.000Z",
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: 500,
      clock
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.postings).toHaveLength(3);
    expect(result.failure?.kind).toBe("deadline");
    expect(result.failure?.disabled).toBe(false);
  });

  it("case 9: deadline already passed -> fetches nothing at all", async () => {
    const fetch: FetchLike = vi.fn().mockResolvedValue(fixtureResponse());

    const result = await linkedinPortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: 0,
      clock: () => 1_000
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.postings).toEqual([]);
    expect(result.failure?.kind).toBe("deadline");
  });

  it("linkedin-specific 1: a 200-status auth-wall interstitial is login_required, not parse_failed", async () => {
    const fetch: FetchLike = vi.fn().mockResolvedValue(authWallResponse());

    const result = await linkedinPortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    // Fails against a status-only mapping (statusToKind alone never sees this: the response is
    // 200 OK), which would classify the wall as parse_failed and retry it forever.
    expect(result.postings).toEqual([]);
    expect(result.failure?.kind).toBe("login_required");
    expect(result.failure?.disabled).toBe(true);
    expect(result.failure?.retryAt).toBeNull();
  });

  it("linkedin-specific 2: stops paging when a page comes back with no cards", async () => {
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValueOnce(
        pageResponse([
          card({ id: "1", title: "A", company: "Acme", location: "Remote", date: "2026-07-01" }),
          card({ id: "2", title: "B", company: "Acme", location: "Remote", date: "2026-07-01" }),
          card({ id: "3", title: "C", company: "Acme", location: "Remote", date: "2026-07-01" })
        ])
      )
      .mockResolvedValueOnce(emptyPageResponse());

    const result = await linkedinPortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    // Fails against an implementation that walks `start` to PAGE_CAP every time and spends nine
    // requests learning nothing — the guest endpoint reports no total and no next cursor, so an
    // empty fragment is the only honest end-of-results signal it gives.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.failure).toBeNull();
    expect(result.postings).toHaveLength(3);
  });

  it("statusToKind covers every status this adapter treats specially", () => {
    expect(statusToKind(429)).toBe("rate_limited");
    expect(statusToKind(401)).toBe("login_required");
    expect(statusToKind(403)).toBe("login_required");
    expect(statusToKind(404)).toBe("parse_failed");
    expect(statusToKind(500)).toBe("network");
    expect(statusToKind(418)).toBe("network");
  });
});
