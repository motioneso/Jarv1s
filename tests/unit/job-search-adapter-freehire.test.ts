// tests/unit/job-search-adapter-freehire.test.ts
//
// Task 11 (#1295): pins the freehire adapter's contract — what it sends, how it maps a real
// captured payload, and (the load-bearing half) how every failure kind behaves. A source that
// silently returns zero postings instead of a disabling `parse_failed` is the worst failure
// this module can have: it reads exactly like "nothing matched your search."
//
// Every case that is not about the deadline passes a FAR_FUTURE deadline, so a slow CI box
// cannot turn an unrelated assertion into a flake.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { SearchCriteria } from "../../external-modules/job-search/src/domain/records.js";
import { freehirePortal } from "../../external-modules/job-search/src/adapters/freehire.js";
import type { FetchLike } from "../../external-modules/job-search/src/adapters/types.js";
import { PAGE_CAP, statusToKind } from "../../external-modules/job-search/src/adapters/types.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/job-search/freehire-data.json", import.meta.url)
);
const RAW_FIXTURE = readFileSync(FIXTURE_PATH, "utf8");

// Real captured-and-trimmed freehire.me `__data.json` response (three postings), 2026-07-27.
// `hasMore` in the real capture is false (freehire really did return it that way for this
// query), so this fixture alone can only ever exercise a single-page crawl — cases that need a
// second page use `buildEnvelope` below instead of pretending the real capture says otherwise.
function fixtureResponse() {
  return { ok: true, status: 200, text: async () => RAW_FIXTURE };
}

/** Builds a minimal, valid devalue-format `__data.json` envelope from plain job objects, for
 * tests that need to control `hasMore`/`total` rather than read the real (single-page)
 * fixture. Mirrors the flat-pool encoding documented in freehire.ts's header exactly, so a bug
 * in the adapter's resolution logic can't hide behind a test double that doesn't match the
 * real wire format. */
function buildEnvelope(
  jobs: ReadonlyArray<Record<string, unknown>>,
  hasMore: boolean,
  total: number | null
): string {
  const pool: unknown[] = [null];

  function flatten(value: unknown): number {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const idxDict: Record<string, number> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        idxDict[k] = flatten(v);
      }
      pool.push(idxDict);
      return pool.length - 1;
    }
    if (Array.isArray(value)) {
      const idxList = value.map((v) => flatten(v));
      pool.push(idxList);
      return pool.length - 1;
    }
    pool.push(value);
    return pool.length - 1;
  }

  function pushRefContainer(container: unknown): number {
    pool.push(container);
    return pool.length - 1;
  }

  const jobIndices = jobs.map((jobValue) => flatten(jobValue));
  const itemsIdx = pushRefContainer(jobIndices);
  const hasMoreIdx = flatten(hasMore);
  const wrapperFields: Record<string, number> = { items: itemsIdx, hasMore: hasMoreIdx };
  if (total !== null) {
    wrapperFields.total = flatten(total);
  }
  const wrapperIdx = pushRefContainer(wrapperFields);
  pool[0] = { initial: wrapperIdx };

  return JSON.stringify({
    type: "data",
    nodes: [
      { type: "data", data: [{ user: null }, null], uses: {} },
      { type: "data", data: pool, uses: {} }
    ]
  });
}

function job(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    title: "Platform Engineer",
    company: "Acme",
    location: "Remote",
    url: "https://acme.example.com/jobs/1",
    external_id: "acme:1",
    description: "<p>Build distributed things.</p>",
    posted_at: "2026-07-27T00:00:00.000Z",
    ...overrides
  };
}

function pageResponse(jobs: ReadonlyArray<Record<string, unknown>>, hasMore: boolean, total: number | null = null) {
  const body = buildEnvelope(jobs, hasMore, total);
  return { ok: true, status: 200, text: async () => body };
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

describe("freehire adapter (#1295)", () => {
  it("case 1: maps the captured __data.json payload onto Posting records", async () => {
    const fetch: FetchLike = vi.fn().mockResolvedValue(fixtureResponse());

    const result = await freehirePortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(result.failure).toBeNull();
    expect(result.postings).toHaveLength(3);
    for (const posting of result.postings) {
      // The "no empty strings" assertions are what catch an index read as a value instead of
      // being resolved through it — a bug that silently produces "" or a stray small integer
      // coerced to a one-character string, not a thrown error.
      expect(posting.id).toBe("");
      expect(posting.sourceId).toBe("freehire");
      expect(posting.externalId.length).toBeGreaterThan(0);
      expect(posting.title.length).toBeGreaterThan(0);
      expect(posting.company.length).toBeGreaterThan(0);
      expect(posting.url.startsWith("https://")).toBe(true);
      expect(posting.body.length).toBeGreaterThan(20);
    }
  });

  it("case 2: sends q, work_mode and regions — the only three parameters that filter", async () => {
    const fetch: FetchLike = vi.fn().mockResolvedValue(fixtureResponse());

    await freehirePortal.crawl({
      fetch,
      criteria: criteria({ titles: ["staff engineer"], remote: "required" }),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    const url = new URL(calledUrl);
    expect(url.pathname).toBe("/__data.json");
    expect(url.pathname.startsWith("/api/")).toBe(false);
    expect(url.searchParams.get("q")).toBe("staff engineer");
    expect(url.searchParams.get("work_mode")).toBe("remote");
    expect(url.searchParams.get("regions")).toBe("global");
  });

  it("case 3: 429 -> structured rate_limited, partial results kept", async () => {
    // Page one reports hasMore: true (matching freehire's real behaviour on a large result
    // set) so the loop actually attempts a second page, which is where the 429 lands.
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValueOnce(pageResponse([job({ external_id: "a:1" }), job({ external_id: "a:2" }), job({ external_id: "a:3" })], true, 190))
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "" });

    const result = await freehirePortal.crawl({
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
    // Page one's reported total survives into the failure copy for a later page.
    expect(result.failure?.expected).toBe(190);
  });

  it("case 4: 401/403 -> login_required and disables itself", async () => {
    for (const status of [401, 403]) {
      const fetch: FetchLike = vi.fn().mockResolvedValue({ ok: false, status, text: async () => "" });

      const result = await freehirePortal.crawl({
        fetch,
        criteria: criteria(),
        lastOkAt: null,
        now: "2026-07-27T12:00:00.000Z",
        deadlineAt: FAR_FUTURE
      });

      expect(result.postings).toHaveLength(0);
      expect(result.failure?.kind).toBe("login_required");
      expect(result.failure?.disabled).toBe(true);
      // Fails against a generic error path that retries a login wall forever.
      expect(result.failure?.retryAt).toBeNull();
    }
  });

  it("case 5: unrecognised envelope disables rather than reporting zero jobs", async () => {
    // Well-formed JSON, `type: "data"`, but not the shape this adapter understands — the
    // SvelteKit "redirect" envelope freehire actually returns when work_mode/regions are both
    // omitted is exactly this kind of well-formed-but-wrong payload.
    const malformed = JSON.stringify({ type: "redirect", location: "/?work_mode=remote" });
    const fetch: FetchLike = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => malformed });

    const result = await freehirePortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    // This is the misleading-silence case: "0 postings" with no failure reads to the user as
    // "nothing matched your search". It must never be reported that way.
    expect(result.postings).toEqual([]);
    expect(result.failure?.kind).toBe("parse_failed");
    expect(result.failure?.disabled).toBe(true);
    expect(result.failure?.summary).toContain("freehire.me");
  });

  it("case 6: non-JSON body -> parse_failed, no postings", async () => {
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => "<html>not json</html>" });

    const result = await freehirePortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(result.postings).toEqual([]);
    expect(result.failure?.kind).toBe("parse_failed");
  });

  it("case 7: deadline expires between pages -> returns what it has", async () => {
    // hasMore: true so the loop would continue to a second page if the deadline check didn't
    // stop it first — a fixture that stopped on its own (hasMore: false) couldn't distinguish
    // "stopped because of the deadline" from "stopped because the source said so".
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValue(pageResponse([job({ external_id: "b:1" }), job({ external_id: "b:2" }), job({ external_id: "b:3" })], true));
    let calls = 0;
    // First check (before page 0) passes; second check (before page 1) is past deadline.
    const clock = () => {
      calls += 1;
      return calls === 1 ? 0 : 1_000;
    };

    const result = await freehirePortal.crawl({
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
    // A slow run must never disable a portal.
    expect(result.failure?.disabled).toBe(false);
  });

  it("case 8: deadline already passed -> fetches nothing at all", async () => {
    const fetch: FetchLike = vi.fn().mockResolvedValue(fixtureResponse());

    const result = await freehirePortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: 0,
      clock: () => 1_000
    });

    // Fails against a do-while shape that always fetches once before checking the deadline.
    expect(fetch).not.toHaveBeenCalled();
    expect(result.postings).toEqual([]);
    expect(result.failure?.kind).toBe("deadline");
  });

  it("case 9: stops paging at PAGE_CAP against a source that never reports a total", async () => {
    // hasMore: true forever, and no total field at all — the real, unresolved live behaviour
    // (no confirmed pagination parameter) looks exactly like this from the adapter's point of
    // view: every page comes back claiming there is more.
    const neverEndingPage = JSON.stringify({
      type: "data",
      nodes: [
        { type: "data", data: [{ user: null }, null], uses: {} },
        { type: "data", data: [{ initial: 1 }, { items: 2, hasMore: 3 }, [], true], uses: {} }
      ]
    });
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => neverEndingPage });

    const result = await freehirePortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(fetch).toHaveBeenCalledTimes(PAGE_CAP);
    // Hitting the cap is a self-imposed boundary, not a failure — the crawl otherwise
    // succeeded on every page it fetched.
    expect(result.failure).toBeNull();
  });

  it("statusToKind covers every status this adapter treats specially", () => {
    expect(statusToKind(429)).toBe("rate_limited");
    expect(statusToKind(401)).toBe("login_required");
    expect(statusToKind(403)).toBe("login_required");
    expect(statusToKind(404)).toBe("parse_failed");
    expect(statusToKind(500)).toBe("network");
    expect(statusToKind(418)).toBe("network");
  });

  it("a rejected fetch resolves to a network failure, not a rejected promise", async () => {
    const fetch: FetchLike = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    const result = await freehirePortal.crawl({
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

  it("a well-formed page with zero real results is not a failure at all", async () => {
    // Distinct from case 5: this is a genuinely valid envelope reporting an empty result set —
    // confirmed live against freehire.me with an unmatchable query. It must pass through as
    // zero postings with NO failure, never as a parse_failed.
    const emptyResults = JSON.stringify({
      type: "data",
      nodes: [
        { type: "data", data: [{ user: null }, null], uses: {} },
        {
          type: "data",
          data: [{ initial: 1 }, { items: 2, total: 3, hasMore: 4 }, [], 0, false],
          uses: {}
        }
      ]
    });
    const fetch: FetchLike = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => emptyResults });

    const result = await freehirePortal.crawl({
      fetch,
      criteria: criteria(),
      lastOkAt: null,
      now: "2026-07-27T12:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(result.postings).toEqual([]);
    expect(result.failure).toBeNull();
  });
});
