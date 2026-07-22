// tests/unit/external-module-job-search-adapters-fetch-discovery.test.ts
//
// JS-10 (#1229): fetchDiscovery orchestration + parseBroadQuery — the discovery
// siblings of fetchBoard. Same guard order and error hygiene as fetch-board,
// extended for the fan-out shape (a broad query issues multiple per-title GETs):
//   - compliance/kill-switch + courtesy are checked before any URL is built;
//   - EVERY built URL's host is re-asserted against fetchHosts before its fetch
//     (a provider bug must never become an off-host request), failing with a
//     FIXED message that never echoes the url;
//   - status/transport/JSON errors surface as fixed-message JobSearchFetchErrors
//     that never leak attacker-influenced response bodies;
//   - postings accumulate across ALL requests and hard-truncate to
//     MAX_BROAD_POSTINGS_PER_RUN (spec §6.5 / AC6).
// parseBroadQuery re-validates a stored blob back into a bounded DiscoveryQuery
// so storage drift can never reach the outbound-minimization boundary.
import { describe, expect, it } from "vitest";

import {
  fetchDiscovery,
  parseBroadQuery
} from "../../external-modules/job-search/src/adapters/fetch-discovery.js";
import type { FetchDiscoveryDeps } from "../../external-modules/job-search/src/adapters/fetch-discovery.js";
import { createFreehireProvider } from "../../external-modules/job-search/src/adapters/freehire.js";
import type { DiscoveryQuery } from "../../external-modules/job-search/src/adapters/discovery-types.js";
import { MAX_BROAD_POSTINGS_PER_RUN } from "../../external-modules/job-search/src/adapters/discovery-types.js";
import type { AdapterFetch } from "../../external-modules/job-search/src/adapters/fetch-board.js";
import { JobSearchFetchError } from "../../external-modules/job-search/src/adapters/types.js";
import { InputError } from "../../external-modules/job-search/src/worker/validate.js";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const provider = createFreehireProvider();
const QUERY: DiscoveryQuery = { titles: ["Backend"], locations: [], country: "us", maxResults: 50 };
const BODY = JSON.stringify({
  data: [{ url: "https://job-boards.greenhouse.io/adyen/jobs/1", title: "T", company: "C" }],
  meta: {}
});

// No default for isActive: omitted must fall through to fetchDiscovery's
// registry default (mirrors the fetch-board suite's deps helper).
function deps(fetch: AdapterFetch, isActive?: (id: string) => boolean): FetchDiscoveryDeps {
  return { fetch, now: () => NOW, ...(isActive ? { isActive } : {}) };
}

async function expectFetchError(
  promise: Promise<unknown>,
  code: string,
  message?: string
): Promise<void> {
  try {
    await promise;
    expect.unreachable("should have thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(JobSearchFetchError);
    expect((error as JobSearchFetchError).code).toBe(code);
    if (message !== undefined) expect((error as JobSearchFetchError).message).toBe(message);
  }
}

describe("parseBroadQuery", () => {
  it("re-validates a well-formed blob and applies defaults", () => {
    expect(parseBroadQuery({ titles: ["Backend"] })).toEqual({
      titles: ["Backend"],
      locations: [],
      country: "us",
      maxResults: MAX_BROAD_POSTINGS_PER_RUN
    });
  });

  it("trims titles/locations and drops empties, keeping bounded facets", () => {
    const query = parseBroadQuery({
      titles: ["  Backend  ", "   ", "Staff"],
      locations: ["  Berlin ", "  "],
      remote: true,
      country: "GB",
      maxResults: 25
    });
    expect(query.titles).toEqual(["Backend", "Staff"]);
    expect(query.locations).toEqual(["Berlin"]);
    expect(query.remote).toBe(true);
    expect(query.country).toBe("gb");
    expect(query.maxResults).toBe(25);
  });

  it("requires at least one non-empty title", () => {
    for (const blob of [{}, { titles: [] }, { titles: ["   "] }]) {
      expect(() => parseBroadQuery(blob)).toThrow(InputError);
    }
  });

  it("rejects malformed country and out-of-range maxResults", () => {
    expect(() => parseBroadQuery({ titles: ["x"], country: "usa" })).toThrow(InputError);
    expect(() => parseBroadQuery({ titles: ["x"], country: "1" })).toThrow(InputError);
    expect(() => parseBroadQuery({ titles: ["x"], maxResults: 0 })).toThrow(InputError);
    expect(() => parseBroadQuery({ titles: ["x"], maxResults: 51 })).toThrow(InputError);
  });

  it("rejects non-string titles entries (never coerces)", () => {
    expect(() => parseBroadQuery({ titles: ["ok", 7] })).toThrow(InputError);
    expect(() => parseBroadQuery({ titles: "Backend" })).toThrow(InputError);
  });

  it("leaves remote undefined when unset", () => {
    expect(parseBroadQuery({ titles: ["x"] }).remote).toBeUndefined();
  });
});

describe("fetchDiscovery orchestration", () => {
  it("refuses disabled providers before any fetch", async () => {
    let fetched = false;
    const stub: AdapterFetch = async () => {
      fetched = true;
      return { status: 200, bodyText: BODY };
    };
    await expectFetchError(
      fetchDiscovery(
        deps(stub, () => false),
        provider,
        QUERY
      ),
      "adapter_disabled"
    );
    expect(fetched).toBe(false);
  });

  it("defaults isActive to the registry, so unregistered providers cannot fetch", async () => {
    const rogue = { ...provider, id: "linkedin" };
    const stub: AdapterFetch = async () => ({ status: 200, bodyText: BODY });
    await expectFetchError(fetchDiscovery(deps(stub, undefined), rogue, QUERY), "adapter_disabled");
  });

  it("refuses before the courtesy interval elapses", async () => {
    const stub: AdapterFetch = async () => ({ status: 200, bodyText: BODY });
    await expectFetchError(
      fetchDiscovery(deps(stub), provider, QUERY, NOW.toISOString()),
      "courtesy_not_due"
    );
  });

  it("re-asserts each built URL host against fetchHosts (defense in depth)", async () => {
    let fetched = false;
    const buggy = { ...provider, buildRequests: () => [{ url: "https://evil.example/jobs" }] };
    const stub: AdapterFetch = async () => {
      fetched = true;
      return { status: 200, bodyText: BODY };
    };
    await expectFetchError(
      fetchDiscovery(
        deps(stub, () => true),
        buggy,
        QUERY
      ),
      "fetch_failed",
      "network request failed"
    );
    expect(fetched).toBe(false);
  });

  it("maps transport failures to a fixed fetch_failed message", async () => {
    const stub: AdapterFetch = async () => {
      throw new Error("connect ECONNREFUSED http://169.254.169.254/latest/meta-data/");
    };
    await expectFetchError(
      fetchDiscovery(
        deps(stub, () => true),
        provider,
        QUERY
      ),
      "fetch_failed",
      "network request failed"
    );
  });

  it("maps non-200 status to unexpected_status without echoing the body", async () => {
    const stub: AdapterFetch = async () => ({ status: 503, bodyText: "<html>attacker</html>" });
    try {
      await fetchDiscovery(
        deps(stub, () => true),
        provider,
        QUERY
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as JobSearchFetchError).code).toBe("unexpected_status");
      expect((error as JobSearchFetchError).message).toContain("503");
      expect((error as JobSearchFetchError).message).not.toContain("attacker");
    }
  });

  it("maps unparseable bodies to a fixed malformed_payload message", async () => {
    const stub: AdapterFetch = async () => ({ status: 200, bodyText: "<html>attacker</html>" });
    try {
      await fetchDiscovery(
        deps(stub, () => true),
        provider,
        QUERY
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as JobSearchFetchError).code).toBe("malformed_payload");
      expect((error as JobSearchFetchError).message).not.toContain("attacker");
    }
  });

  it("returns postings plus complete evidence on success", async () => {
    const stub: AdapterFetch = async () => ({ status: 200, bodyText: BODY });
    const expectedUrl = provider.buildRequests(QUERY)[0]!.url;
    const result = await fetchDiscovery(
      deps(stub, () => true),
      provider,
      QUERY
    );
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]!.externalId).toBe("");
    expect(result.evidence).toEqual({
      adapterId: "freehire",
      host: "freehire.dev",
      url: expectedUrl,
      httpStatus: 200,
      fetchedAt: NOW.toISOString(),
      postingCount: 1,
      skippedCount: 0
    });
  });

  it("hard-truncates combined postings across all requests to the run ceiling", async () => {
    // 3 titles × 30 valid postings = 90 produced; only 50 kept, 40 dropped.
    const bulk = (offset: number): string =>
      JSON.stringify({
        data: Array.from({ length: 30 }, (_, i) => ({
          url: `https://job-boards.greenhouse.io/adyen/jobs/${offset + i}`,
          title: `Role ${offset + i}`,
          company: "C"
        })),
        meta: {}
      });
    let call = 0;
    const stub: AdapterFetch = async () => ({ status: 200, bodyText: bulk(call++ * 100) });
    const result = await fetchDiscovery(
      deps(stub, () => true),
      provider,
      {
        ...QUERY,
        titles: ["a", "b", "c"]
      }
    );
    expect(call).toBe(3); // one GET per title
    expect(result.postings).toHaveLength(MAX_BROAD_POSTINGS_PER_RUN);
    expect(result.evidence.postingCount).toBe(MAX_BROAD_POSTINGS_PER_RUN);
    expect(result.evidence.skippedCount).toBe(90 - MAX_BROAD_POSTINGS_PER_RUN);
  });
});
