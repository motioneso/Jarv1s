// external-modules/job-search/src/adapters/greenhouse.ts
//
// JS-04 (#933): Greenhouse Job Board API adapter. Public unauthenticated
// endpoint (https://developers.greenhouse.io/job-board.html); the board token
// is validated by parseBoardConfig and the host is pinned by the platform
// fetch layer — this adapter only ever emits URLs on boards-api.greenhouse.io.
// Greenhouse `content` is entity-ESCAPED HTML, so normalize decodes once and
// then strips; hostile or malformed items are skipped and counted, never
// trusted or echoed into errors.
import { truncateUtf8 } from "../domain/index.js";
import { DESCRIPTION_MAX_BYTES } from "../domain/limits.js";
import { httpsUrl, parseBoardConfig, parseIsoTimestamp, record } from "./board-config.js";
import { decodeEntities, sanitizeInlineField, stripHtmlToText } from "./sanitize.js";
import type { NormalizedPosting, NormalizeResult, SourceAdapter } from "./types.js";
import {
  JobSearchFetchError,
  LOCATION_MAX_CHARS,
  MAX_POSTINGS_PER_FETCH,
  TITLE_MAX_CHARS
} from "./types.js";

const RULES = {
  adapterId: "greenhouse",
  tokenPattern: /^[a-z0-9]{1,100}$/,
  urlHosts: ["boards.greenhouse.io", "job-boards.greenhouse.io"]
} as const;

export const greenhouseAdapter: SourceAdapter = {
  id: "greenhouse",
  displayName: "Greenhouse job board",
  fetchHosts: ["boards-api.greenhouse.io"],
  compliance: {
    policyUrl: "https://developers.greenhouse.io/job-board.html",
    reviewedAt: "2026-07-11",
    reviewedBy: "coordinator/automated",
    status: "allowed"
  },
  courtesyIntervalMs: 60 * 60 * 1000,
  configHint:
    'Greenhouse board token (e.g. "gitlab") or a https://boards.greenhouse.io/<token> URL',
  validateConfig: (query) => parseBoardConfig(query, RULES),
  buildUrl: (config) =>
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(config.board)}/jobs?content=true`,
  normalize(payload, config): NormalizeResult {
    const root = record(payload);
    const jobs = root ? root.jobs : undefined;
    if (!Array.isArray(jobs)) {
      throw new JobSearchFetchError(
        "malformed_payload",
        "greenhouse payload is missing the jobs array"
      );
    }
    const postings: NormalizedPosting[] = [];
    let skippedCount = 0;
    for (const item of jobs) {
      if (postings.length >= MAX_POSTINGS_PER_FETCH) {
        skippedCount += 1;
        continue;
      }
      const job = record(item);
      const id =
        job && (typeof job.id === "number" || typeof job.id === "string") ? String(job.id) : null;
      const canonicalUrl = job ? httpsUrl(job.absolute_url) : null;
      const title =
        job && typeof job.title === "string" ? sanitizeInlineField(job.title, TITLE_MAX_CHARS) : "";
      if (!job || !id || !canonicalUrl || !title) {
        skippedCount += 1;
        continue;
      }
      const locations: string[] = [];
      const loc = record(job.location);
      if (loc && typeof loc.name === "string") {
        locations.push(sanitizeInlineField(loc.name, LOCATION_MAX_CHARS));
      }
      if (Array.isArray(job.offices)) {
        for (const o of job.offices) {
          const office = record(o);
          if (office && typeof office.name === "string") {
            const name = sanitizeInlineField(office.name, LOCATION_MAX_CHARS);
            if (name && !locations.includes(name)) locations.push(name);
          }
        }
      }
      // Greenhouse `content` is entity-escaped HTML: decode once, then strip.
      const rawContent = typeof job.content === "string" ? job.content : "";
      const description = truncateUtf8(
        stripHtmlToText(decodeEntities(rawContent)),
        DESCRIPTION_MAX_BYTES
      );
      const publishedAt = parseIsoTimestamp(job.first_published);
      const workMode = locations.some((l) => /\bremote\b/i.test(l))
        ? ("remote" as const)
        : undefined;
      postings.push({
        externalId: id,
        canonicalUrl,
        title,
        company: config.companyName ?? config.board,
        locations,
        ...(workMode ? { workMode } : {}),
        ...(publishedAt ? { publishedAt } : {}),
        description: description.text,
        descriptionTruncated: description.truncated
      });
    }
    return { postings, skippedCount };
  }
};
