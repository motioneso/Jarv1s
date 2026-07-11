// external-modules/job-search/src/domain/limits.ts
//
// JS-02 (#931): fixed retention/size limits for the owner-scoped KV domain.
// Values are pinned by the approved spec (2026-07-10-job-search-js-02-kv-domain)
// — do not tune without a spec change.

// Strictly BELOW the platform DB check (octet_length(value::text) <= 65536,
// migration 0154) so the domain always rejects before the database would.
export const KV_VALUE_MAX_BYTES = 65_535;

// 48 KB of UTF-8 pasted resume text; checked before any write.
export const RESUME_INPUT_MAX_BYTES = 49_152;

// Job-posting description cap (16 KB); longer text is truncated on a UTF-8
// boundary and flagged, never rejected.
export const DESCRIPTION_MAX_BYTES = 16_384;

// Retention targets (see retention.ts for the pass order they drive).
export const OPPORTUNITY_TARGET = 500;
export const PASSED_STALE_EVICT_DAYS = 30;
export const TOMBSTONE_TTL_DAYS = 60;
export const RUN_RETENTION_MAX = 50;
export const RUN_RETENTION_DAYS = 14;

// User-facing rejection copy for oversized resume input — exact wording is
// part of the spec contract (asserted verbatim in tests; JS-03 surfaces it).
export const RESUME_TOO_LARGE_MESSAGE =
  "Resume text is over the 48 KB limit (49,152 bytes of UTF-8). Trim it and paste it again.";
