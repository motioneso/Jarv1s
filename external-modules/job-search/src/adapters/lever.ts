// external-modules/job-search/src/adapters/lever.ts
//
// JS-04 (#933): Lever Postings API adapter. Public unauthenticated endpoint
// (https://github.com/lever/postings-api); site tokens allow hyphens and
// uppercase, unlike greenhouse. Payload is a bare array. descriptionPlain is
// preferred but STILL stripped — "plain" is Lever's claim about their own
// rendering, not a trust boundary we accept from an external body.
import { truncateUtf8 } from "../domain/index.js";
import { DESCRIPTION_MAX_BYTES } from "../domain/limits.js";
import {
  httpsUrl,
  mapWorkMode,
  parseBoardConfig,
  parseIsoTimestamp,
  record
} from "./board-config.js";
import { sanitizeInlineField, stripHtmlToText } from "./sanitize.js";
import type { NormalizedPosting, NormalizeResult, SourceAdapter } from "./types.js";
import {
  COMPENSATION_MAX_CHARS,
  EMPLOYMENT_TYPE_MAX_CHARS,
  JobSearchFetchError,
  LOCATION_MAX_CHARS,
  MAX_POSTINGS_PER_FETCH,
  TITLE_MAX_CHARS
} from "./types.js";

export const leverAdapter: SourceAdapter = {
  id: "lever",
  displayName: "Lever postings",
  fetchHosts: ["api.lever.co"],
  compliance: {
    policyUrl: "https://github.com/lever/postings-api",
    reviewedAt: "2026-07-11",
    reviewedBy: "coordinator/automated",
    status: "allowed"
  },
  courtesyIntervalMs: 60 * 60 * 1000,
  configHint: 'Lever site name (e.g. "leverdemo") or a https://jobs.lever.co/<site> URL',
  validateConfig: (query) =>
    parseBoardConfig(query, {
      adapterId: "lever",
      tokenPattern: /^[a-zA-Z0-9-]{1,100}$/,
      urlHosts: ["jobs.lever.co"]
    }),
  buildUrl: (config) =>
    `https://api.lever.co/v0/postings/${encodeURIComponent(config.board)}?mode=json`,
  normalize(payload, config): NormalizeResult {
    if (!Array.isArray(payload)) {
      throw new JobSearchFetchError("malformed_payload", "lever payload is not a postings array");
    }
    const postings: NormalizedPosting[] = [];
    let skippedCount = 0;
    for (const item of payload) {
      if (postings.length >= MAX_POSTINGS_PER_FETCH) {
        skippedCount += 1;
        continue;
      }
      const job = record(item);
      const id = job && typeof job.id === "string" ? job.id : null;
      const canonicalUrl = job ? httpsUrl(job.hostedUrl) : null;
      const title =
        job && typeof job.text === "string" ? sanitizeInlineField(job.text, TITLE_MAX_CHARS) : "";
      if (!job || !id || !canonicalUrl || !title) {
        skippedCount += 1;
        continue;
      }
      const categories = record(job.categories) ?? {};
      const locations: string[] = [];
      const all = Array.isArray(categories.allLocations)
        ? categories.allLocations
        : [categories.location];
      for (const l of all) {
        if (typeof l === "string") {
          const name = sanitizeInlineField(l, LOCATION_MAX_CHARS);
          if (name && !locations.includes(name)) locations.push(name);
        }
      }
      const workMode = mapWorkMode(job.workplaceType);
      const employmentType =
        typeof categories.commitment === "string"
          ? sanitizeInlineField(categories.commitment, EMPLOYMENT_TYPE_MAX_CHARS)
          : undefined;
      // Compensation only when the range is a real finite pair — Lever omits
      // or nulls salaryRange on most public boards.
      const salary = record(job.salaryRange);
      const compensation =
        salary &&
        typeof salary.min === "number" &&
        typeof salary.max === "number" &&
        Number.isFinite(salary.min) &&
        Number.isFinite(salary.max)
          ? sanitizeInlineField(
              `${salary.min}–${salary.max}${typeof salary.currency === "string" ? ` ${salary.currency}` : ""}${typeof salary.interval === "string" ? ` per ${salary.interval.replace(/-/g, " ")}` : ""}`,
              COMPENSATION_MAX_CHARS
            )
          : undefined;
      const rawDescription =
        typeof job.descriptionPlain === "string" && job.descriptionPlain.trim().length > 0
          ? job.descriptionPlain
          : typeof job.description === "string"
            ? job.description
            : "";
      const description = truncateUtf8(stripHtmlToText(rawDescription), DESCRIPTION_MAX_BYTES);
      const publishedAt = parseIsoTimestamp(job.createdAt);
      postings.push({
        externalId: id,
        canonicalUrl,
        title,
        company: config.companyName ?? config.board,
        locations,
        ...(workMode ? { workMode } : {}),
        ...(employmentType ? { employmentType } : {}),
        ...(compensation ? { compensation } : {}),
        ...(publishedAt ? { publishedAt } : {}),
        description: description.text,
        descriptionTruncated: description.truncated
      });
    }
    return { postings, skippedCount };
  }
};
