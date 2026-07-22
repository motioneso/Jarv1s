// external-modules/job-search/src/adapters/fetch-discovery.ts
//
// JS-10 (#1229): the discovery sibling of fetch-board.ts — the single
// orchestration path from a JobDiscoveryProvider to normalized postings. Same
// guard order and error hygiene as fetch-board, extended for the fan-out shape
// (a broad query issues MULTIPLE per-title requests):
//   1. compliance/kill-switch (registry) and courtesy are checked before any
//      URL is built;
//   2. EVERY built URL's host is re-asserted against the provider's fetchHosts
//      before its fetch runs (defense in depth — a provider bug must not become
//      a network request; the platform's host-pinned fetch stays the real
//      enforcement layer);
//   3. postings are accumulated across all of a query's requests and then
//      HARD-TRUNCATED to MAX_BROAD_POSTINGS_PER_RUN (spec §6.5 / AC6) so a
//      multi-request fan-out can never exceed the single-run ingestion ceiling.
//
// Error hygiene is identical: every thrown JobSearchFetchError carries a FIXED
// message naming the constraint only — upstream transport errors and response
// bodies may echo attacker-controlled URLs or HTML and never reach a message.
import { getDiscoveryProvider } from "./discovery-registry.js";
import type { DiscoveryQuery, JobDiscoveryProvider } from "./discovery-types.js";
import { MAX_BROAD_POSTINGS_PER_RUN } from "./discovery-types.js";
import { type AdapterFetch, type AdapterFetchResponse, courtesyDue } from "./fetch-board.js";
import { JobSearchFetchError, type FetchEvidence, type NormalizedPosting } from "./types.js";
import { InputError, readBool, readInt, readString, readStringArray } from "../worker/validate.js";

export interface FetchDiscoveryDeps {
  readonly fetch: AdapterFetch;
  now(): Date;
  // Defaults to the discovery registry (compliance gate + kill switch).
  // Injectable so tests can exercise the disabled path without mutating state.
  readonly isActive?: (adapterId: string) => boolean;
}

/**
 * Re-validate a stored broad-query blob into a typed DiscoveryQuery at run
 * time: storage drift must never reach buildRequests (defense in depth on the
 * outbound-minimization boundary, mirroring adapter.validateConfig). Every
 * field is bounded; anything malformed throws InputError, which the run handler
 * turns into an "invalid_config" run record. Only titles + locations + coarse
 * remote + country are read — nothing else can become an outbound query param.
 */
export function parseBroadQuery(query: Record<string, unknown>): DiscoveryQuery {
  const titles = readStringArray(query, "titles", { maxBytes: 512 })
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (titles.length === 0) {
    throw new InputError("titles requires at least one non-empty entry");
  }
  const locations = readStringArray(query, "locations", { maxBytes: 512 })
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const remote = readBool(query, "remote");
  const country = (readString(query, "country", { maxBytes: 8 }) ?? "us").toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) {
    throw new InputError("country must be a 2-letter ISO code");
  }
  const maxResults =
    readInt(query, "maxResults", { min: 1, max: MAX_BROAD_POSTINGS_PER_RUN }) ??
    MAX_BROAD_POSTINGS_PER_RUN;
  return {
    titles,
    locations,
    country,
    maxResults,
    ...(remote !== undefined ? { remote } : {})
  };
}

export async function fetchDiscovery(
  deps: FetchDiscoveryDeps,
  provider: JobDiscoveryProvider,
  query: DiscoveryQuery,
  lastCheckedAt?: string
): Promise<{ postings: readonly NormalizedPosting[]; evidence: FetchEvidence }> {
  const isActive =
    deps.isActive ?? ((adapterId: string) => getDiscoveryProvider(adapterId) !== null);
  if (!isActive(provider.id)) {
    throw new JobSearchFetchError("adapter_disabled", "adapter is not enabled for fetching");
  }

  if (!courtesyDue(lastCheckedAt, provider.courtesyIntervalMs, deps.now())) {
    throw new JobSearchFetchError("courtesy_not_due", "courtesy interval has not elapsed");
  }

  const requests = provider.buildRequests(query);
  const postings: NormalizedPosting[] = [];
  let skippedCount = 0;
  let lastStatus = 200;
  let firstUrl = "";

  for (const request of requests) {
    const host = new URL(request.url).hostname.toLowerCase();
    if (!provider.fetchHosts.includes(host)) {
      // Fixed message on purpose: the off-host URL is provider-derived but
      // still never belongs in an error surfaced to callers.
      throw new JobSearchFetchError("fetch_failed", "network request failed");
    }
    if (firstUrl === "") firstUrl = request.url;

    let response: AdapterFetchResponse;
    try {
      response = await deps.fetch({ url: request.url });
    } catch (error) {
      if (error instanceof JobSearchFetchError) throw error;
      throw new JobSearchFetchError("fetch_failed", "network request failed");
    }
    lastStatus = response.status;
    if (response.status !== 200) {
      // Status number only — response bodies are attacker-influenced.
      throw new JobSearchFetchError(
        "unexpected_status",
        `unexpected HTTP status ${response.status}`
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(response.bodyText);
    } catch {
      throw new JobSearchFetchError("malformed_payload", "response body is not valid JSON");
    }

    const result = provider.normalize(payload);
    skippedCount += result.skippedCount;
    for (const posting of result.postings) {
      // Combined-across-requests hard cap (spec §6.5 / AC6). Anything past the
      // ceiling is dropped and counted, never surfaced.
      if (postings.length >= MAX_BROAD_POSTINGS_PER_RUN) {
        skippedCount += 1;
        continue;
      }
      postings.push(posting);
    }
  }

  const evidence: FetchEvidence = {
    adapterId: provider.id,
    host: provider.fetchHosts[0] ?? "",
    // The built search URL carries only the minimized outbound query (titles +
    // country + coarse remote); evidence is ephemeral (run records persist
    // counts only, never evidence.url).
    url: firstUrl,
    httpStatus: lastStatus,
    fetchedAt: deps.now().toISOString(),
    postingCount: postings.length,
    skippedCount
  };
  return { postings, evidence };
}
