// tests/unit/external-module-job-search-adapters-fetch.test.ts
//
// JS-04 (#933) Task 8: fetchBoard orchestration + SSRF adversarial wiring.
// The SSRF suite drives the REAL createHostPinnedFetch from @jarv1s/host-fetch
// (coordinator mandate — not a mock of it) with injected resolve/request
// fakes, mirroring worker-rpc-host.ts `fetch.request` (same manifest host
// allowlist, same base64 response envelope). Every attack must fail with the
// request fake never invoked, and must surface through fetchBoard as
// JobSearchFetchError("fetch_failed") with a FIXED message — upstream error
// text may echo attacker-controlled URLs.
import { describe, expect, it } from "vitest";

import {
  courtesyDue,
  fetchBoard,
  fetchFromWorkerContext
} from "../../external-modules/job-search/src/adapters/fetch-board.js";
import type {
  AdapterFetch,
  ModuleFetchLike
} from "../../external-modules/job-search/src/adapters/fetch-board.js";
import { greenhouseAdapter } from "../../external-modules/job-search/src/adapters/greenhouse.js";
import { JobSearchFetchError } from "../../external-modules/job-search/src/adapters/types.js";
import type { SourceAdapter } from "../../external-modules/job-search/src/adapters/types.js";
import type {
  HostPinnedFetchOptions,
  PinnedRequest,
  PinnedResponse
} from "../../packages/host-fetch/src/index.js";
import { createHostPinnedFetch } from "../../packages/host-fetch/src/index.js";

const MANIFEST_HOSTS = ["boards-api.greenhouse.io", "api.lever.co", "api.ashbyhq.com"] as const;
const PUBLIC_ADDR = { address: "93.184.216.34", family: 4 as const };
const NOW = new Date("2026-07-11T12:00:00.000Z");
const GH_URL = "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true";
const GH_BODY = JSON.stringify({
  jobs: [
    {
      id: 1,
      absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/1",
      title: "Role",
      content: "body"
    }
  ]
});

const cfg = greenhouseAdapter.validateConfig({ board: "gitlab" });

// No default for isActive: an explicit/omitted undefined must fall through to
// fetchBoard's registry default (a `= () => true` default here would swallow
// the registry-default test — JS applies defaults to explicit undefined too).
function deps(fetch: AdapterFetch, isActive?: (id: string) => boolean) {
  return { fetch, now: () => NOW, ...(isActive ? { isActive } : {}) };
}

function pinnedResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {}
): PinnedResponse {
  return {
    status,
    headers,
    body: (async function* () {
      yield Buffer.from(bodyText);
    })()
  };
}

// Structural mirror of worker-rpc-host.ts `fetch.request`: host-pinned fetch
// in front, base64 envelope out. This is what ctx.fetch is on the other side
// of the RPC boundary, so driving it proves the module path end-to-end.
function moduleFetchOver(pinned: typeof fetch): ModuleFetchLike {
  return async (request) => {
    const response = await pinned(request.url, {
      method: request.method ?? "GET",
      ...(request.headers ? { headers: request.headers } : {})
    });
    const headers: Record<string, string> = {};
    const contentType = response.headers.get("content-type");
    if (contentType !== null) headers["content-type"] = contentType;
    return {
      status: response.status,
      headers,
      bodyBase64: Buffer.from(await response.arrayBuffer()).toString("base64")
    };
  };
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

describe("courtesyDue", () => {
  const interval = 60 * 60 * 1000;

  it("is due with no cursor, at exactly the interval, and for garbage cursors", () => {
    expect(courtesyDue(undefined, interval, NOW)).toBe(true);
    expect(courtesyDue(new Date(NOW.getTime() - interval).toISOString(), interval, NOW)).toBe(true);
    // Cursor is derived state — a corrupted value fails OPEN to fetching.
    expect(courtesyDue("garbage", interval, NOW)).toBe(true);
  });

  it("is not due one millisecond before the interval elapses", () => {
    expect(courtesyDue(new Date(NOW.getTime() - interval + 1).toISOString(), interval, NOW)).toBe(
      false
    );
  });
});

describe("fetchBoard orchestration", () => {
  it("refuses disabled adapters before any fetch", async () => {
    let fetched = false;
    const stub: AdapterFetch = async () => {
      fetched = true;
      return { status: 200, bodyText: GH_BODY };
    };
    await expectFetchError(
      fetchBoard(
        deps(stub, () => false),
        greenhouseAdapter,
        cfg
      ),
      "adapter_disabled"
    );
    expect(fetched).toBe(false);
  });

  it("defaults isActive to the registry, so unregistered adapters cannot fetch", async () => {
    const rogue: SourceAdapter = { ...greenhouseAdapter, id: "linkedin" };
    const stub: AdapterFetch = async () => ({ status: 200, bodyText: GH_BODY });
    await expectFetchError(fetchBoard(deps(stub, undefined), rogue, cfg), "adapter_disabled");
  });

  it("refuses before the courtesy interval elapses", async () => {
    const stub: AdapterFetch = async () => ({ status: 200, bodyText: GH_BODY });
    await expectFetchError(
      fetchBoard(deps(stub), greenhouseAdapter, cfg, NOW.toISOString()),
      "courtesy_not_due"
    );
  });

  it("re-asserts the built URL host against adapter fetchHosts (defense in depth)", async () => {
    let fetched = false;
    const buggy: SourceAdapter = {
      ...greenhouseAdapter,
      buildUrl: () => "https://evil.example/jobs"
    };
    const stub: AdapterFetch = async () => {
      fetched = true;
      return { status: 200, bodyText: GH_BODY };
    };
    await expectFetchError(fetchBoard(deps(stub), buggy, cfg), "fetch_failed");
    expect(fetched).toBe(false);
  });

  it("maps transport failures to a fixed fetch_failed message", async () => {
    const stub: AdapterFetch = async () => {
      throw new Error("connect ECONNREFUSED http://169.254.169.254/latest/meta-data/");
    };
    await expectFetchError(
      fetchBoard(deps(stub), greenhouseAdapter, cfg),
      "fetch_failed",
      "network request failed"
    );
  });

  it("maps 404 to board_not_found and other statuses to unexpected_status", async () => {
    const notFound: AdapterFetch = async () => ({ status: 404, bodyText: "<html>gone</html>" });
    await expectFetchError(fetchBoard(deps(notFound), greenhouseAdapter, cfg), "board_not_found");

    const flaky: AdapterFetch = async () => ({ status: 503, bodyText: "<html>attacker</html>" });
    try {
      await fetchBoard(deps(flaky), greenhouseAdapter, cfg);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as JobSearchFetchError).code).toBe("unexpected_status");
      // Status number only — never the response body.
      expect((error as JobSearchFetchError).message).toContain("503");
      expect((error as JobSearchFetchError).message).not.toContain("attacker");
    }
  });

  it("maps unparseable bodies to a fixed malformed_payload message", async () => {
    const stub: AdapterFetch = async () => ({ status: 200, bodyText: "<html>attacker</html>" });
    try {
      await fetchBoard(deps(stub), greenhouseAdapter, cfg);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as JobSearchFetchError).code).toBe("malformed_payload");
      expect((error as JobSearchFetchError).message).not.toContain("attacker");
    }
  });

  it("returns postings plus complete fetch evidence on success", async () => {
    const stub: AdapterFetch = async () => ({ status: 200, bodyText: GH_BODY });
    const result = await fetchBoard(deps(stub), greenhouseAdapter, cfg);
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]!.externalId).toBe("1");
    expect(result.evidence).toEqual({
      adapterId: "greenhouse",
      host: "boards-api.greenhouse.io",
      url: GH_URL,
      httpStatus: 200,
      fetchedAt: "2026-07-11T12:00:00.000Z",
      postingCount: 1,
      skippedCount: 0
    });
  });
});

describe("fetchFromWorkerContext", () => {
  it("decodes the base64 body envelope to utf8 text", async () => {
    const moduleFetch: ModuleFetchLike = async () => ({
      status: 200,
      headers: {},
      bodyBase64: Buffer.from('{"jobs":[]}', "utf8").toString("base64")
    });
    const result = await fetchFromWorkerContext(moduleFetch)({ url: GH_URL });
    expect(result).toEqual({ status: 200, bodyText: '{"jobs":[]}' });
  });

  it("maps a rejecting moduleFetch to fetch_failed with the fixed message", async () => {
    const moduleFetch: ModuleFetchLike = async () => {
      throw new Error("rpc failed for https://evil.example/echoed-url");
    };
    await expectFetchError(
      fetchFromWorkerContext(moduleFetch)({ url: GH_URL }),
      "fetch_failed",
      "network request failed"
    );
  });
});

describe("SSRF wiring through the real host-pinned fetch", () => {
  function pinnedWith(options: HostPinnedFetchOptions): typeof fetch {
    return createHostPinnedFetch(MANIFEST_HOSTS, options);
  }

  function trackingRequest(
    handler: (request: PinnedRequest) => PinnedResponse | Promise<PinnedResponse>
  ) {
    const seen: PinnedRequest[] = [];
    const request = async (req: PinnedRequest): Promise<PinnedResponse> => {
      seen.push(req);
      return handler(req);
    };
    return { seen, request };
  }

  it("never connects for an undeclared host", async () => {
    const { seen, request } = trackingRequest(() => pinnedResponse(200, GH_BODY));
    const pinned = pinnedWith({ resolve: async () => [PUBLIC_ADDR], request });
    await expect(pinned("https://evil.example/jobs")).rejects.toMatchObject({
      code: "host_not_declared"
    });
    expect(seen).toHaveLength(0);
  });

  it.each([
    ["cloud metadata", [{ address: "169.254.169.254", family: 4 as const }]],
    ["loopback IPv4", [{ address: "127.0.0.1", family: 4 as const }]],
    ["loopback IPv6", [{ address: "::1", family: 6 as const }]],
    // DNS-rebind shape: one public answer, one private — must reject the lot.
    ["mixed public+private", [PUBLIC_ADDR, { address: "10.0.0.1", family: 4 as const }]]
  ])("never connects when DNS answers are %s", async (_name, answers) => {
    const { seen, request } = trackingRequest(() => pinnedResponse(200, GH_BODY));
    const pinned = pinnedWith({ resolve: async () => answers, request });
    await expect(pinned(GH_URL)).rejects.toMatchObject({ code: "blocked_address" });
    expect(seen).toHaveLength(0);
  });

  it("rejects redirects that escape the allowlist", async () => {
    const { seen, request } = trackingRequest(() =>
      pinnedResponse(302, "", { location: "https://evil.example/" })
    );
    const pinned = pinnedWith({ resolve: async () => [PUBLIC_ADDR], request });
    await expect(pinned(GH_URL)).rejects.toMatchObject({ code: "host_not_declared" });
    expect(seen).toHaveLength(1); // first hop only — the escape never connects
  });

  it("rejects redirects to non-https metadata endpoints", async () => {
    const { seen, request } = trackingRequest(() =>
      pinnedResponse(302, "", { location: "http://169.254.169.254/latest/meta-data/" })
    );
    const pinned = pinnedWith({ resolve: async () => [PUBLIC_ADDR], request });
    await expect(pinned(GH_URL)).rejects.toMatchObject({ code: "invalid_request" });
    expect(seen).toHaveLength(1);
  });

  it("follows same-host relative redirects (revalidation, not a blanket ban)", async () => {
    const { seen, request } = trackingRequest((req) =>
      req.path === "/v1/x"
        ? pinnedResponse(200, GH_BODY, { "content-type": "application/json" })
        : pinnedResponse(302, "", { location: "/v1/x" })
    );
    const pinned = pinnedWith({ resolve: async () => [PUBLIC_ADDR], request });
    const response = await pinned(GH_URL);
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.path).toBe("/v1/x");
    expect(seen[1]!.host).toBe("boards-api.greenhouse.io");
  });

  it.each([
    ["decimal IP", "https://2130706433/", "host_not_declared"],
    ["hex IP", "https://0x7f000001/", "host_not_declared"],
    ["IPv6 any", "https://[::]/", "host_not_declared"],
    ["userinfo smuggling", "https://boards-api.greenhouse.io@evil.example/", "invalid_request"]
  ])("never connects for %s encodings", async (_name, url, code) => {
    const { seen, request } = trackingRequest(() => pinnedResponse(200, GH_BODY));
    const pinned = pinnedWith({ resolve: async () => [PUBLIC_ADDR], request });
    await expect(pinned(url)).rejects.toMatchObject({ code });
    expect(seen).toHaveLength(0);
  });

  it("aborts over-cap bodies and hung requests", async () => {
    const big = pinnedWith({
      resolve: async () => [PUBLIC_ADDR],
      request: async () => pinnedResponse(200, "x".repeat(100)),
      maxResponseBytes: 64
    });
    await expect(big(GH_URL)).rejects.toMatchObject({ code: "response_too_large" });

    const hung = pinnedWith({
      resolve: async () => [PUBLIC_ADDR],
      request: () => new Promise<PinnedResponse>(() => {}),
      timeoutMs: 25
    });
    await expect(hung(GH_URL)).rejects.toMatchObject({ code: "fetch_timeout" });
  });

  it("surfaces every pinned-fetch rejection through fetchBoard as fetch_failed", async () => {
    const scenarios: HostPinnedFetchOptions[] = [
      // Rebind-shaped DNS answer.
      {
        resolve: async () => [{ address: "169.254.169.254", family: 4 as const }],
        request: async () => pinnedResponse(200, GH_BODY)
      },
      // Redirect escape to an undeclared host.
      {
        resolve: async () => [PUBLIC_ADDR],
        request: async () => pinnedResponse(302, "", { location: "https://evil.example/" })
      },
      // Redirect to the metadata service over plain http.
      {
        resolve: async () => [PUBLIC_ADDR],
        request: async () =>
          pinnedResponse(302, "", { location: "http://169.254.169.254/latest/meta-data/" })
      },
      // Response body over the byte cap.
      {
        resolve: async () => [PUBLIC_ADDR],
        request: async () => pinnedResponse(200, "x".repeat(100)),
        maxResponseBytes: 64
      },
      // Hung upstream.
      {
        resolve: async () => [PUBLIC_ADDR],
        request: () => new Promise<PinnedResponse>(() => {}),
        timeoutMs: 25
      }
    ];
    for (const options of scenarios) {
      const adapterFetch = fetchFromWorkerContext(moduleFetchOver(pinnedWith(options)));
      await expectFetchError(
        fetchBoard(deps(adapterFetch), greenhouseAdapter, cfg),
        "fetch_failed",
        "network request failed"
      );
    }
  });

  it("fails closed even when a compromised adapter declares an undeclared host", async () => {
    // The manifest allowlist inside the pinned fetch is the enforcement layer;
    // adapter self-declaration passing fetchBoard's re-assert must not matter.
    const { seen, request } = trackingRequest(() => pinnedResponse(200, GH_BODY));
    const compromised: SourceAdapter = {
      ...greenhouseAdapter,
      fetchHosts: ["evil.example"],
      buildUrl: () => "https://evil.example/jobs"
    };
    const adapterFetch = fetchFromWorkerContext(
      moduleFetchOver(pinnedWith({ resolve: async () => [PUBLIC_ADDR], request }))
    );
    await expectFetchError(
      fetchBoard(deps(adapterFetch), compromised, cfg),
      "fetch_failed",
      "network request failed"
    );
    expect(seen).toHaveLength(0);
  });

  it("delivers a real board payload end-to-end through the pinned stack", async () => {
    const { request } = trackingRequest(() =>
      pinnedResponse(200, GH_BODY, { "content-type": "application/json" })
    );
    const adapterFetch = fetchFromWorkerContext(
      moduleFetchOver(pinnedWith({ resolve: async () => [PUBLIC_ADDR], request }))
    );
    const result = await fetchBoard(deps(adapterFetch), greenhouseAdapter, cfg);
    expect(result.postings).toHaveLength(1);
    expect(result.evidence.httpStatus).toBe(200);
    expect(result.evidence.host).toBe("boards-api.greenhouse.io");
  });
});
