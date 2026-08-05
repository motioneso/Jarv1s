// external-modules/job-search/src/worker/ports.ts
//
// Task 13 (#1297): bridges `ctx.fetch` (one `ModuleFetchRequest` object in, `{status, headers,
// bodyBase64}` out — no `ok`, no `text()`) to `FetchLike` (Task 11's `../adapters/types.js`),
// which every portal adapter is written and tested against. This is the ONLY place that decodes
// base64 or derives `ok` from a status code — adapters must never learn ctx.fetch isn't WHATWG
// fetch.
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import type { FetchLike } from "../adapters/types.js";

export function toFetchLike(ctx: ModuleWorkerContext): FetchLike {
  return async (url, init) => {
    const response = await ctx.fetch({
      url,
      method: "GET",
      ...(init?.headers !== undefined ? { headers: init.headers } : {})
    });
    // Decoded eagerly, not behind a lazy text(): the body is already fully in memory as base64,
    // so laziness buys nothing and only moves a decode failure somewhere harder to attribute.
    const body = Buffer.from(response.bodyBase64, "base64").toString("utf8");
    return {
      // Derived, not host-provided: ctx.fetch resolves on every status (a 429 is not a
      // rejection), so `ok` is exactly what WHATWG fetch would report for the same status.
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: () => Promise.resolve(body)
    };
  };
}
