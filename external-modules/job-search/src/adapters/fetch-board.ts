// external-modules/job-search/src/adapters/fetch-board.ts
//
// JS-04 (#933) Task 8: the single orchestration path from a source adapter to
// normalized postings. Guard order is deliberate — compliance (registry) and
// courtesy are checked before any URL is even built, and the built URL's host
// is re-asserted against the adapter's declared fetchHosts before the fetch
// runs (defense in depth: an adapter bug must not become a network request;
// the platform's host-pinned fetch remains the real enforcement layer).
//
// Error hygiene: every thrown JobSearchFetchError carries a FIXED message
// naming the constraint only. Upstream transport errors and response bodies
// may echo attacker-controlled URLs or HTML, so their text never reaches an
// error message (spec §compliance / security tier).
import { getSourceAdapter } from "./registry.js";
import {
  JobSearchFetchError,
  type BoardConfig,
  type FetchEvidence,
  type NormalizedPosting,
  type SourceAdapter
} from "./types.js";

export interface AdapterFetchResponse {
  readonly status: number;
  readonly bodyText: string;
}

export type AdapterFetch = (request: { readonly url: string }) => Promise<AdapterFetchResponse>;

// Structural mirror of ctx.fetch (packages/module-sdk/src/worker.ts) — NOT an
// SDK import, same kv-port pattern as the rest of this module: the module
// depends on the shape, the host owns the type.
export interface ModuleFetchLike {
  (request: {
    url: string;
    method?: "GET" | "POST";
    headers?: Readonly<Record<string, string>>;
  }): Promise<{
    status: number;
    headers: Readonly<Record<string, string>>;
    bodyBase64: string;
  }>;
}

// Adapt ctx.fetch's base64 envelope to the plain-text AdapterFetch the
// orchestration consumes. ANY throw collapses to a fixed message because the
// host-pinned fetch's rejection text includes the offending URL — useful in
// host logs, unsafe to surface through module error paths.
export function fetchFromWorkerContext(moduleFetch: ModuleFetchLike): AdapterFetch {
  return async (request) => {
    try {
      const response = await moduleFetch({ url: request.url });
      return {
        status: response.status,
        bodyText: Buffer.from(response.bodyBase64, "base64").toString("utf8")
      };
    } catch {
      throw new JobSearchFetchError("fetch_failed", "network request failed");
    }
  };
}

// Courtesy cursor is derived state, not a security boundary — a missing or
// corrupted lastCheckedAt fails OPEN to fetching so a bad KV write can never
// permanently wedge a source.
export function courtesyDue(
  lastCheckedAt: string | undefined,
  intervalMs: number,
  now: Date
): boolean {
  if (lastCheckedAt === undefined) return true;
  const parsed = Date.parse(lastCheckedAt);
  if (Number.isNaN(parsed)) return true;
  return now.getTime() - parsed >= intervalMs;
}

export interface FetchBoardDeps {
  readonly fetch: AdapterFetch;
  now(): Date;
  // Defaults to the registry (compliance gate + kill switch). Injectable so
  // tests can exercise the disabled path without mutating module state.
  readonly isActive?: (adapterId: string) => boolean;
}

export async function fetchBoard(
  deps: FetchBoardDeps,
  adapter: SourceAdapter,
  config: BoardConfig,
  lastCheckedAt?: string
): Promise<{ postings: readonly NormalizedPosting[]; evidence: FetchEvidence }> {
  const isActive = deps.isActive ?? ((adapterId: string) => getSourceAdapter(adapterId) !== null);
  if (!isActive(adapter.id)) {
    throw new JobSearchFetchError("adapter_disabled", "adapter is not enabled for fetching");
  }

  if (!courtesyDue(lastCheckedAt, adapter.courtesyIntervalMs, deps.now())) {
    throw new JobSearchFetchError("courtesy_not_due", "courtesy interval has not elapsed");
  }

  const url = adapter.buildUrl(config);
  const host = new URL(url).hostname;
  if (!adapter.fetchHosts.includes(host)) {
    // Fixed message on purpose: the bogus URL is adapter-derived but still
    // never belongs in an error surfaced to callers.
    throw new JobSearchFetchError("fetch_failed", "network request failed");
  }

  let response: AdapterFetchResponse;
  try {
    response = await deps.fetch({ url });
  } catch (error) {
    if (error instanceof JobSearchFetchError) throw error;
    throw new JobSearchFetchError("fetch_failed", "network request failed");
  }

  if (response.status === 404) {
    throw new JobSearchFetchError("board_not_found", "board not found (HTTP 404)");
  }
  if (response.status !== 200) {
    // Status number only — response bodies are attacker-influenced.
    throw new JobSearchFetchError("unexpected_status", `unexpected HTTP status ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.bodyText);
  } catch {
    throw new JobSearchFetchError("malformed_payload", "response body is not valid JSON");
  }

  const { postings, skippedCount } = adapter.normalize(payload, config);
  const evidence: FetchEvidence = {
    adapterId: adapter.id,
    host,
    url,
    httpStatus: response.status,
    fetchedAt: deps.now().toISOString(),
    postingCount: postings.length,
    skippedCount
  };
  return { postings, evidence };
}
