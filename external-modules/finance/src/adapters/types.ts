// external-modules/finance/src/adapters/types.ts
//
// FIN-01 (#1146): the adapters-layer contract. Unlike job-search's read-only
// board fetches, the Plaid API is POST-JSON with credentials as BODY FIELDS
// (grounded decision D1): the FIN-00 transport secret guard rejects any
// child→host RPC carrying a resolved credential as a plaintext substring in
// `fetch.request` url/headers, so `bodyBase64` is the only sanctioned channel.
// The fetch port therefore carries method/headers/bodyBase64 through to the
// host, which pins hosts to the manifest fetchHosts.

export type PlaidEnv = "production" | "sandbox";

export interface FinanceFetchRequest {
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Record<string, string>;
  readonly bodyBase64?: string;
}

export interface FinanceFetchResponse {
  readonly status: number;
  /** Decoded UTF-8 response body (Plaid responses are JSON text). */
  readonly bodyText: string;
}

export type FinanceFetch = (request: FinanceFetchRequest) => Promise<FinanceFetchResponse>;

export type FinanceFetchErrorCode = "fetch_failed" | "unexpected_status" | "malformed_payload";

export class FinanceFetchError extends Error {
  readonly code: FinanceFetchErrorCode;

  // Messages name the constraint only — NEVER external response content and
  // never credentials (same scrubbed-by-construction contract as
  // InputError/FinanceKvError).
  constructor(code: FinanceFetchErrorCode, message: string) {
    super(message);
    this.name = "FinanceFetchError";
    this.code = code;
  }
}
