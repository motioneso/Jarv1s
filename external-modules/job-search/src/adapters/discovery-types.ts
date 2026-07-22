// external-modules/job-search/src/adapters/discovery-types.ts
//
// JS-10 (#1229): the broad-discovery provider seam — a deliberately minimal
// sibling to SourceAdapter (spec 2026-07-21-job-search-broad-discovery §6.1).
// A board adapter watches ONE company's ATS board; a discovery provider runs a
// profile-derived SEARCH across many companies. Both emit the SAME
// NormalizedPosting, so upsert/gate/evaluation/feed/retention consume them
// identically — only fetch + normalize differ.
//
// Security parity with SourceAdapter: fetchHosts must be ⊆ jarvis.module.json
// fetchHosts (the platform's host-pinned fetch is the real enforcement layer,
// not provider self-declaration), and the registry refuses any provider whose
// compliance review is not explicitly "allowed" (fail closed, discovery-registry.ts).
import type { AdapterCompliance, NormalizeResult } from "./types.js";

// Hard per-run ingestion cap for broad discovery (spec §6.5). A broad query can
// return far more than a single board, so this is BELOW the board cap
// (MAX_POSTINGS_PER_FETCH = 500) to keep ingestion inside the 500-opportunity
// retention ceiling and the AI-eval budget. Enforced in fetch-discovery across
// ALL of a query's requests combined, and again defensively per normalize().
export const MAX_BROAD_POSTINGS_PER_RUN = 50;

// A broad query fans out to at most this many per-title requests (spec §6.2:
// "titles ... per-title requests"). Bounds outbound volume and keeps the run
// courteous; extra titles are dropped (the gate still enforces the full profile
// locally, and titles are a precision lever, not a filter — spec §10.3).
export const MAX_BROAD_TITLE_REQUESTS = 3;

/**
 * The coarse, profile-derived search a broad run issues. Deliberately carries
 * ONLY titles + locations + coarse remote (+ country) — the facets that leave
 * the instance (spec §6.2 / §7.4 outbound minimization / AC5). Salary,
 * dealbreakers, excluded companies, and employment type are NEVER sent
 * outbound; the local deterministic gate applies them after fetch (spec §10.3).
 */
export interface DiscoveryQuery {
  readonly titles: readonly string[]; // from profile.targetTitles
  readonly locations: readonly string[]; // from profile.locations (gate-applied; not all sent outbound)
  readonly remote?: boolean; // coarse, derived from profile.remotePreference
  readonly country: string; // ISO-2, operator/profile default "us"
  readonly maxResults: number; // hard cap per run (see MAX_BROAD_POSTINGS_PER_RUN)
}

/**
 * A single GET the provider wants the safe reader to make. Only a URL crosses
 * the seam — the fetch-discovery orchestrator re-asserts the host against the
 * provider's fetchHosts before any network call, exactly as fetch-board does.
 * No method/headers/body: broad discovery is public, keyless, GET-only.
 */
export interface DiscoveryRequest {
  readonly url: string;
}

export interface JobDiscoveryProvider {
  readonly id: string; // e.g. "freehire"; must match assertId pattern (keys.ts)
  readonly displayName: string;
  // Exact lowercase hostnames; must be ⊆ jarvis.module.json fetchHosts.
  readonly fetchHosts: readonly string[];
  readonly compliance: AdapterCompliance; // must be "allowed" or it never registers
  readonly courtesyIntervalMs: number;
  // Populated ONLY for sources that mandate attribution (e.g. Adzuna's "Jobs by
  // Adzuna"). Keyless ATS-sourced providers (freehire) carry the employer
  // canonical URL and need no third-party label, so they leave this absent
  // (spec §6.4 / §6.6).
  readonly attribution?: {
    readonly label: string;
    readonly href: string;
  };
  // Builds the request(s) from a query. Any credential (Path A only) is injected
  // by the safe reader, NEVER by the provider — keeps secrets out of provider
  // code and logs (spec §6.1 / §7.2). Keyless providers inject nothing.
  buildRequests(query: DiscoveryQuery): readonly DiscoveryRequest[];
  // Throws JobSearchFetchError("malformed_payload") on shape violations; drops
  // and counts individual hostile/malformed items (never throws for one item).
  normalize(payload: unknown): NormalizeResult;
}
