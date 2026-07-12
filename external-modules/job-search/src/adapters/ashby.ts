// external-modules/job-search/src/adapters/ashby.ts
//
// JS-04 (#933): Ashby posting-api adapter. Public unauthenticated endpoint
// (https://developers.ashbyhq.com/docs/public-job-posting-api); org names may
// contain dots, unlike greenhouse/lever tokens. Payload is `{jobs: [...]}`
// like greenhouse. Unlisted postings (isListed === false) are skipped — Ashby
// serves them for direct links but they are not board-published, so surfacing
// them would leak postings the company withdrew.
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

export const ashbyAdapter: SourceAdapter = {
  id: "ashby",
  displayName: "Ashby job board",
  fetchHosts: ["api.ashbyhq.com"],
  compliance: {
    policyUrl: "https://developers.ashbyhq.com/docs/public-job-posting-api",
    reviewedAt: "2026-07-11",
    reviewedBy: "coordinator/automated",
    status: "allowed"
  },
  courtesyIntervalMs: 60 * 60 * 1000,
  configHint: 'Ashby job board name (e.g. "ramp") or a https://jobs.ashbyhq.com/<name> URL',
  validateConfig: (query) =>
    parseBoardConfig(query, {
      adapterId: "ashby",
      tokenPattern: /^[A-Za-z0-9._-]{1,100}$/,
      urlHosts: ["jobs.ashbyhq.com"]
    }),
  buildUrl: (config) =>
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(config.board)}?includeCompensation=true`,
  normalize(payload, config): NormalizeResult {
    const root = record(payload);
    const jobs = root ? root.jobs : undefined;
    if (!Array.isArray(jobs)) {
      throw new JobSearchFetchError("malformed_payload", "ashby payload is missing the jobs array");
    }
    const postings: NormalizedPosting[] = [];
    let skippedCount = 0;
    for (const item of jobs) {
      if (postings.length >= MAX_POSTINGS_PER_FETCH) {
        skippedCount += 1;
        continue;
      }
      const job = record(item);
      if (!job || job.isListed === false) {
        skippedCount += 1;
        continue;
      }
      const id = typeof job.id === "string" ? job.id : null;
      const canonicalUrl = httpsUrl(job.jobUrl);
      const title =
        typeof job.title === "string" ? sanitizeInlineField(job.title, TITLE_MAX_CHARS) : "";
      if (!id || !canonicalUrl || !title) {
        skippedCount += 1;
        continue;
      }
      const locations: string[] = [];
      if (typeof job.location === "string") {
        const name = sanitizeInlineField(job.location, LOCATION_MAX_CHARS);
        if (name) locations.push(name);
      }
      if (Array.isArray(job.secondaryLocations)) {
        for (const s of job.secondaryLocations) {
          const sec = record(s);
          if (sec && typeof sec.location === "string") {
            const name = sanitizeInlineField(sec.location, LOCATION_MAX_CHARS);
            if (name && !locations.includes(name)) locations.push(name);
          }
        }
      }
      // isRemote is Ashby's explicit flag; it wins over the workplaceType label
      // (fixture has isRemote:true jobs labelled "Hybrid").
      const workMode = job.isRemote === true ? "remote" : mapWorkMode(job.workplaceType);
      const employmentType =
        typeof job.employmentType === "string"
          ? sanitizeInlineField(job.employmentType, EMPLOYMENT_TYPE_MAX_CHARS)
          : undefined;
      const comp = record(job.compensation);
      const compensation =
        comp && typeof comp.compensationTierSummary === "string"
          ? sanitizeInlineField(comp.compensationTierSummary, COMPENSATION_MAX_CHARS)
          : undefined;
      const rawDescription =
        typeof job.descriptionPlain === "string" && job.descriptionPlain.trim().length > 0
          ? job.descriptionPlain
          : typeof job.descriptionHtml === "string"
            ? job.descriptionHtml
            : "";
      const description = truncateUtf8(stripHtmlToText(rawDescription), DESCRIPTION_MAX_BYTES);
      const publishedAt = parseIsoTimestamp(job.publishedAt);
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
