// external-modules/job-search/src/adapters/types.ts
//
// JS-04 (#933): the adapter contract. Adapters are pure data + functions
// (validateConfig → buildUrl → normalize) with compliance metadata carried on
// the adapter itself — the registry refuses anything not explicitly reviewed
// "allowed" (fail closed, spec §compliance). fetchHosts must be a subset of
// the manifest fetchHosts so the platform's host-pinned fetch is the real
// enforcement layer, not adapter self-declaration.

export type ComplianceStatus = "allowed" | "unknown" | "prohibited";

export interface AdapterCompliance {
  readonly policyUrl: string;
  readonly reviewedAt: string;
  // Coordinator mandate (plan approval 2026-07-11): attribution is
  // "coordinator/automated", never a human who did not perform the review.
  readonly reviewedBy: string;
  readonly status: ComplianceStatus;
}

export interface BoardConfig {
  readonly board: string;
  readonly companyName?: string;
}

export type WorkMode = "remote" | "hybrid" | "onsite";

export interface NormalizedPosting {
  readonly externalId: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly company: string;
  readonly locations: readonly string[];
  readonly workMode?: WorkMode;
  readonly employmentType?: string;
  readonly compensation?: string;
  readonly publishedAt?: string;
  readonly description: string;
  readonly descriptionTruncated: boolean;
}

export interface NormalizeResult {
  readonly postings: readonly NormalizedPosting[];
  readonly skippedCount: number;
}

export interface FetchEvidence {
  readonly adapterId: string;
  readonly host: string;
  readonly url: string;
  readonly httpStatus: number;
  readonly fetchedAt: string;
  readonly postingCount: number;
  readonly skippedCount: number;
}

export interface SourceAdapter {
  readonly id: string;
  readonly displayName: string;
  // Exact lowercase hostnames; must be ⊆ jarvis.module.json fetchHosts.
  readonly fetchHosts: readonly string[];
  readonly compliance: AdapterCompliance;
  readonly courtesyIntervalMs: number;
  // Human hint surfaced to the assistant, e.g. "board token or
  // https://boards.greenhouse.io/<token> URL".
  readonly configHint: string;
  validateConfig(query: Record<string, unknown>): BoardConfig; // throws InputError
  buildUrl(config: BoardConfig): string;
  // Throws JobSearchFetchError("malformed_payload") on shape violations.
  normalize(payload: unknown, config: BoardConfig): NormalizeResult;
}

export type JobSearchFetchErrorCode =
  | "adapter_disabled"
  | "courtesy_not_due"
  | "fetch_failed"
  | "board_not_found"
  | "unexpected_status"
  | "malformed_payload";

export class JobSearchFetchError extends Error {
  readonly code: JobSearchFetchErrorCode;

  // Messages name the constraint only — NEVER external response content
  // (same scrubbed-by-construction contract as InputError/JobSearchKvError).
  constructor(code: JobSearchFetchErrorCode, message: string) {
    super(message);
    this.name = "JobSearchFetchError";
    this.code = code;
  }
}

export const MAX_POSTINGS_PER_FETCH = 500;
export const TITLE_MAX_CHARS = 300;
export const COMPANY_MAX_CHARS = 200;
export const LOCATION_MAX_CHARS = 120;
export const EMPLOYMENT_TYPE_MAX_CHARS = 100;
export const COMPENSATION_MAX_CHARS = 200;
