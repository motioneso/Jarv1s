// external-modules/finance/src/adapters/index.ts
//
// FIN-01 (#1146): public barrel for the adapters layer plus the worker-fetch
// bridge. Handlers import from here only.
import type { FinanceFetch } from "./types.js";
import { FinanceFetchError } from "./types.js";

export * from "./types.js";

// Structural mirror of ModuleWorkerContext["fetch"] — intentionally NOT an
// SDK import so the adapters layer stays bundler-independent (job-search
// ModuleFetchLike pattern). The request shape matches ModuleFetchRequest
// (module-sdk index.ts:648): method/headers/bodyBase64 pass through so the
// Plaid adapter can POST JSON bodies (D1); the host rejects GET+body and
// pins hosts to the manifest fetchHosts.
export interface ModuleFetchLike {
  (request: {
    url: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    bodyBase64?: string;
  }): Promise<{ status: number; bodyBase64: string }>;
}

/**
 * Adapt ctx.fetch to the FinanceFetch port. Every transport failure collapses
 * to one fixed message: host-side fetch errors could echo URLs or response
 * fragments, and nothing from the wire may reach logs or tool results.
 */
export function fetchFromWorkerContext(moduleFetch: ModuleFetchLike): FinanceFetch {
  return async (request) => {
    try {
      const response = await moduleFetch({
        url: request.url,
        ...(request.method !== undefined ? { method: request.method } : {}),
        ...(request.headers !== undefined ? { headers: request.headers } : {}),
        ...(request.bodyBase64 !== undefined ? { bodyBase64: request.bodyBase64 } : {})
      });
      return {
        status: response.status,
        bodyText: Buffer.from(response.bodyBase64, "base64").toString("utf8")
      };
    } catch {
      throw new FinanceFetchError("fetch_failed", "network request failed");
    }
  };
}
