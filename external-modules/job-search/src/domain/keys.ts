// external-modules/job-search/src/domain/keys.ts
//
// JS-02 (#931): identity hashes + the key ABI. Keys carry ids and hashes
// only — ids must match /^[A-Za-z0-9_-]{1,64}$/ and hashes are 32-hex —
// never prose, URLs, or titles, so key listings can't leak private content.
// JS-03/05/06 root on these exact key shapes; changing them is a breaking
// contract change, not a refactor.
import { createHash } from "node:crypto";

import { JobSearchKvError } from "./errors.js";

// 32 hex chars = 128 bits of sha256 — collision-safe at this scale and keeps
// a 500-entry feed index well under the 65_535-byte value cap.
function sha256Hex32(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

/**
 * Stable identity for a job opportunity. Prefers adapter + external id;
 * falls back to canonical URL only when the adapter has no external id.
 * The `id\0` / `url\0` prefixes keep the two derivation paths from ever
 * colliding on equal raw strings.
 */
export function opportunityIdentity(input: {
  adapterId: string;
  externalId?: string;
  canonicalUrl?: string;
}): string {
  if (input.externalId !== undefined && input.externalId !== "") {
    return sha256Hex32(`id\0${input.adapterId}\0${input.externalId}`);
  }
  if (input.canonicalUrl !== undefined && input.canonicalUrl !== "") {
    return sha256Hex32(`url\0${input.canonicalUrl}`);
  }
  throw new JobSearchKvError(
    "invalid_record",
    "opportunity identity requires externalId or canonicalUrl"
  );
}

/** Hash of normalized posting text (callers normalize before hashing). */
export function contentHash(text: string): string {
  return sha256Hex32(text);
}

/**
 * JS-07 (#936): source identity = (adapterId, board). Stored on opportunity
 * records so absence-from-fetch is judged per board — two monitors on one
 * adapter watch different boards, and only the board that was actually
 * fetched may stale its own records. A record field, never key material.
 */
export function sourceKey(adapterId: string, board: string): string {
  return sha256Hex32(`${adapterId}\0${board}`);
}

/**
 * Identity of one evaluation = (posting content, profile revision, resume
 * revision). Any member changing means the evaluation must be redone.
 */
export function evaluationIdentity(input: {
  opportunityContentHash: string;
  profileRevisionId: string;
  resumeRevisionId: string;
}): string {
  return sha256Hex32(
    `eval\0${input.opportunityContentHash}\0${input.profileRevisionId}\0${input.resumeRevisionId}`
  );
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Guard for every id that becomes part of a key. */
export function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    // Deliberately does not echo the offending id — it could be prose.
    throw new JobSearchKvError("invalid_record", "id must match [A-Za-z0-9_-]{1,64}");
  }
}

// The key ABI (module-design table). Builders take pre-validated ids/hashes;
// repositories call assertId before building keys from caller input.
export const keys = {
  onboardingState: "state",
  profileActive: "active",
  profileRevision: (id: string) => `revision/${id}`,
  resumeActive: "active",
  resumeRevision: (id: string) => `revision/${id}`,
  resumeConfirmation: (id: string) => `confirmation/${id}`,
  monitor: (id: string) => `monitor/${id}`,
  monitorCursor: (id: string) => `cursor/${id}`,
  /** JS-05 schedule state (NS.monitors). Key ABI — breaking-contract note above applies. */
  monitorSchedule: (monitorId: string) => `schedule/${monitorId}`,
  job: (h: string) => `job/${h}`,
  tombstone: (h: string) => `tombstone/${h}`,
  /** JS-07 (#936): AI evaluation, keyed by the job's identity hash. */
  evaluation: (h: string) => `eval/${h}`,
  /** JS-07 (#936): daily AI budget ledger, keyed by UTC calendar date. */
  evalBudget: (date: string) => `evalBudget/${date}`,
  run: (monitorId: string, runId: string) => `run/${monitorId}/${runId}`,
  runLatest: (monitorId: string) => `monitor/${monitorId}/latest`,
  feedActive: "active"
} as const;
