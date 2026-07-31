// tests/unit/job-search-fetch-bridge.test.ts
//
// Task 13 (#1297): pins the ctx.fetch -> FetchLike bridge (worker/ports.ts). ctx.fetch is NOT
// WHATWG fetch — one ModuleFetchRequest object in, {status, headers, bodyBase64} out, no `ok`,
// no `text()` — and the adapters (Task 11) must never learn that it isn't.
import { describe, expect, it, vi } from "vitest";

import { toFetchLike } from "../../external-modules/job-search/src/worker/ports.js";

// Structural stand-in for ModuleWorkerContext — only `fetch` is exercised here.
function contextWith(fetch: (request: unknown) => Promise<unknown>) {
  return { fetch } as unknown as Parameters<typeof toFetchLike>[0];
}

describe("job-search worker/ports.ts toFetchLike (#1297)", () => {
  it("decodes the host's base64 body and derives ok from the status", async () => {
    const fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: { "content-type": "text/html" },
      bodyBase64: Buffer.from("<html>hi</html>", "utf8").toString("base64")
    });
    const bridge = toFetchLike(contextWith(fetch));

    const response = await bridge("https://www.linkedin.com/jobs");

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    // Fails against a bridge that passes bodyBase64 through as text instead of decoding it.
    await expect(response.text()).resolves.toBe("<html>hi</html>");
  });

  it("reports a 429 as not-ok rather than throwing", async () => {
    const fetch = vi.fn().mockResolvedValue({
      status: 429,
      headers: {},
      bodyBase64: Buffer.from("slow down", "utf8").toString("base64")
    });
    const bridge = toFetchLike(contextWith(fetch));

    // A throwing bridge would lose the partial results an adapter already collected before
    // hitting the rate limit — the adapter branches on `ok`, it never expects a rejection here.
    const response = await bridge("https://www.linkedin.com/jobs");
    expect(response.ok).toBe(false);
    expect(response.status).toBe(429);
  });

  it("passes request headers through in the host's own one-object shape", async () => {
    const fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      bodyBase64: Buffer.from("", "utf8").toString("base64")
    });
    const bridge = toFetchLike(contextWith(fetch));

    await bridge("https://www.linkedin.com/jobs", { headers: { "x-test": "1" } });

    // ctx.fetch takes exactly one argument — a two-argument call would reach it as an ignored
    // second parameter, and the headers would silently never leave this file.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith({
      url: "https://www.linkedin.com/jobs",
      method: "GET",
      headers: { "x-test": "1" }
    });
  });
});
