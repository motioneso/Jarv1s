// external-modules/job-search/src/adapters/freehire.ts
//
// JS-10 (#1229): the broad-discovery provider (spec 2026-07-21 §6.1 / §6.6,
// Path B′). Unlike a board adapter (watches ONE company's ATS), this runs a
// profile-derived SEARCH across many companies against keyless freehire.dev,
// which serves upstream-deduped, ATS-sourced postings carrying the employer
// CANONICAL url (not a tracking redirect). Consequences (spec §6.6):
//   - No credential: keyless public read, so nothing is injected by the safe
//     reader and no secret can ever exist in provider code or logs.
//   - url-path identity: canonicalUrl is real, and there is no stable provider
//     id we trust, so every posting takes externalId:"" — opportunityIdentity
//     (keys.ts:29) then hashes the canonical url, and two keyless-sourced
//     records for the same posting converge automatically.
//   - No attribution: canonical employer url needs no third-party label.
//   - Outbound minimization (§7.4 / AC5): buildRequests sends ONLY titles +
//     country + a coarse remote flag. Salary, dealbreakers, excluded
//     companies, employment type, and locations-as-a-facet NEVER leave the
//     instance — the local deterministic gate applies them after fetch.
//
// The base url is operator-configurable INSTANCE CONFIG (not a secret): default
// https://freehire.dev, repointable to a self-hosted freehire without any code
// change (spec §6.1). fetchHosts is derived from the base url so host-pinning
// stays correct for either target; it must still be ⊆ jarvis.module.json
// fetchHosts (the platform's host-pinned fetch is the real enforcement layer).
import { truncateUtf8 } from "../domain/index.js";
import { DESCRIPTION_MAX_BYTES } from "../domain/limits.js";
import { httpsUrl, mapWorkMode, parseIsoTimestamp, record } from "./board-config.js";
import type { DiscoveryQuery, DiscoveryRequest, JobDiscoveryProvider } from "./discovery-types.js";
import { MAX_BROAD_POSTINGS_PER_RUN, MAX_BROAD_TITLE_REQUESTS } from "./discovery-types.js";
import { decodeEntities, sanitizeInlineField, stripHtmlToText } from "./sanitize.js";
import type { NormalizedPosting, NormalizeResult } from "./types.js";
import {
  COMPENSATION_MAX_CHARS,
  COMPANY_MAX_CHARS,
  EMPLOYMENT_TYPE_MAX_CHARS,
  JobSearchFetchError,
  LOCATION_MAX_CHARS,
  TITLE_MAX_CHARS
} from "./types.js";

const DEFAULT_BASE_URL = "https://freehire.dev";

// Per-request result page cap: clamp the profile's maxResults into
// [1, MAX_BROAD_POSTINGS_PER_RUN]. The combined-across-requests hard cap is
// re-enforced in fetch-discovery and again defensively in normalize().
function clampLimit(maxResults: number): number {
  if (!Number.isFinite(maxResults)) return MAX_BROAD_POSTINGS_PER_RUN;
  const floored = Math.floor(maxResults);
  if (floored < 1) return 1;
  return Math.min(floored, MAX_BROAD_POSTINGS_PER_RUN);
}

// freehire appends `?utm_source=freehire.dev` to the employer's canonical ATS
// url. url-path identity (spec §6.6) only CONVERGES a broad hit with the same
// posting seen via a board watch if both hash the SAME url — and board adapters
// store the bare canonical (no query). So strip utm_* tracking params here;
// httpsUrl has already validated https + no credentials. Non-utm query params
// (rare on ATS canonicals) are preserved — over-stripping could merge distinct
// postings. URL drops the "?" entirely once the last param is removed.
function stripTrackingParams(validatedUrl: string): string {
  const url = new URL(validatedUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

// freehire location facets: a single `location` string plus optional `regions`
// / `countries` arrays. Each is sanitized (inert plain text), capped, deduped
// in first-seen order — same shape the board adapters produce.
function collectLocations(job: Record<string, unknown>): string[] {
  const locations: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    const name = sanitizeInlineField(value, LOCATION_MAX_CHARS);
    if (name && !locations.includes(name)) locations.push(name);
  };
  add(job.location);
  for (const arr of [job.regions, job.countries]) {
    if (Array.isArray(arr)) for (const value of arr) add(value);
  }
  return locations;
}

// Compensation only when the enrichment carries a real finite salary pair —
// same discipline as lever.ts (external bodies routinely null/omit salary).
function formatCompensation(enrich: Record<string, unknown> | null): string | undefined {
  if (!enrich) return undefined;
  const min = enrich.salary_min;
  const max = enrich.salary_max;
  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max)
  ) {
    return undefined;
  }
  const currency = typeof enrich.salary_currency === "string" ? ` ${enrich.salary_currency}` : "";
  const period =
    typeof enrich.salary_period === "string"
      ? ` per ${enrich.salary_period.replace(/-/g, " ")}`
      : "";
  return sanitizeInlineField(`${min}–${max}${currency}${period}`, COMPENSATION_MAX_CHARS);
}

// One freehire job → NormalizedPosting, or null when the item is malformed or
// hostile (missing canonical url/title/company, non-https url). Throwing is
// reserved for the ENVELOPE (normalize); a single bad item is dropped + counted.
function normalizeItem(item: unknown): NormalizedPosting | null {
  const job = record(item);
  if (!job) return null;
  // Canonical EMPLOYER url (spec §6.6) — must be https or the item is hostile.
  const validatedUrl = httpsUrl(job.url);
  const canonicalUrl = validatedUrl === null ? null : stripTrackingParams(validatedUrl);
  const title =
    typeof job.title === "string" ? sanitizeInlineField(job.title, TITLE_MAX_CHARS) : "";
  const company =
    typeof job.company === "string" ? sanitizeInlineField(job.company, COMPANY_MAX_CHARS) : "";
  if (!canonicalUrl || !title || !company) return null;

  const locations = collectLocations(job);
  const workMode = mapWorkMode(job.work_mode);
  const enrich = record(job.enrichment);
  const employmentType =
    enrich && typeof enrich.employment_type === "string"
      ? sanitizeInlineField(enrich.employment_type, EMPLOYMENT_TYPE_MAX_CHARS)
      : undefined;
  const compensation = formatCompensation(enrich);
  const publishedAt = parseIsoTimestamp(job.posted_at);
  // Prefer the full JD; fall back to the enrichment summary. Decode-then-strip
  // like greenhouse (entity-escaped bodies are common) so the stored text is
  // inert plain-text DATA, never markup or instructions for the downstream AI.
  const rawDescription =
    typeof job.description === "string" && job.description.trim().length > 0
      ? job.description
      : enrich && typeof enrich.summary === "string"
        ? enrich.summary
        : "";
  const description = truncateUtf8(
    stripHtmlToText(decodeEntities(rawDescription)),
    DESCRIPTION_MAX_BYTES
  );

  return {
    // externalId:"" forces url-path identity (spec §6.6); do NOT use public_slug.
    externalId: "",
    canonicalUrl,
    title,
    company,
    locations,
    ...(workMode ? { workMode } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(compensation ? { compensation } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    description: description.text,
    descriptionTruncated: description.truncated
  };
}

/**
 * Construct the freehire provider bound to a base url. The base url is instance
 * configuration (default freehire.dev); a self-hosted deployment repoints it
 * with no code change (spec §6.1). fetchHosts is the base url's host so the
 * fetch-discovery host re-assert pins whichever target is configured.
 */
export function createFreehireProvider(baseUrl: string = DEFAULT_BASE_URL): JobDiscoveryProvider {
  const base = baseUrl.replace(/\/+$/, "");
  const host = new URL(base).hostname.toLowerCase();

  return {
    id: "freehire",
    displayName: "Freehire",
    fetchHosts: [host],
    compliance: {
      // Keyless public search; canonical employer urls, ATS-sourced.
      policyUrl: "https://freehire.dev",
      reviewedAt: "2026-07-22",
      reviewedBy: "coordinator/automated",
      status: "allowed"
    },
    courtesyIntervalMs: 60 * 60 * 1000,
    // No `attribution`: canonical employer url needs no third-party label.
    buildRequests(query: DiscoveryQuery): readonly DiscoveryRequest[] {
      const limit = clampLimit(query.maxResults);
      const country = (query.country || "us").toLowerCase();
      const requests: DiscoveryRequest[] = [];
      for (const rawTitle of query.titles) {
        if (requests.length >= MAX_BROAD_TITLE_REQUESTS) break;
        const title = rawTitle.trim();
        if (title.length === 0) continue;
        // URLSearchParams gives correct encoding and, by construction, emits
        // ONLY the params set here — no salary/dealbreaker/company can leak
        // outbound (AC5). Order is stable for deterministic tests.
        const url = new URL(`${base}/api/v1/jobs/search`);
        url.searchParams.set("q", title);
        url.searchParams.set("limit", String(limit));
        url.searchParams.set("offset", "0");
        url.searchParams.set("sort", "posted_at");
        url.searchParams.set("order", "desc");
        url.searchParams.set("countries", country);
        // Coarse remote flag ONLY when the profile asks for remote.
        if (query.remote === true) url.searchParams.set("work_mode", "remote");
        requests.push({ url: url.toString() });
      }
      return requests;
    },
    normalize(payload: unknown): NormalizeResult {
      const root = record(payload);
      const data = root ? root.data : undefined;
      if (!Array.isArray(data)) {
        // ENVELOPE violation only — the top level must be { data: [...] }.
        throw new JobSearchFetchError(
          "malformed_payload",
          "freehire payload is missing the data array"
        );
      }
      const postings: NormalizedPosting[] = [];
      let skippedCount = 0;
      for (const item of data) {
        // Defensive per-normalize hard cap (fetch-discovery enforces the
        // combined-across-requests cap; this bounds a single hostile envelope).
        if (postings.length >= MAX_BROAD_POSTINGS_PER_RUN) {
          skippedCount += 1;
          continue;
        }
        try {
          const posting = normalizeItem(item);
          if (posting === null) {
            skippedCount += 1;
            continue;
          }
          postings.push(posting);
        } catch {
          // A single malformed item never fails the run (spec §6.6).
          skippedCount += 1;
        }
      }
      return { postings, skippedCount };
    }
  };
}

/** Default provider instance (hosted freehire.dev) registered by the registry. */
export const freehireProvider = createFreehireProvider();
