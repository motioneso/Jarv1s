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

// JS-07 (#936): evaluation record + AI budget limits (approved plan
// 2026-07-11-js-07-freshness-dedup-fit).
// Evaluations live in their own key family (eval/<h>) with a cap well below
// the KV value limit — a job description alone can be 16 KB, so evaluations
// must never ride on (or grow like) the job record.
export const EVALUATION_MAX_BYTES = 24_576;
// Daily AI evaluation budget per owner. NOTE the platform's
// AI_CALLS_PER_INVOCATION_CAP is 8 (repairs included) — the per-invocation
// eval cap stays below it and the daily cap is drained across sweeps.
export const EVAL_DAILY_CAP = 25;
export const PER_INVOCATION_EVAL_MAX = 6;
// evalBudget/<date> ledgers older than this are pruned by retention; the
// boundary day itself is kept (strictly-older prune).
export const EVAL_BUDGET_RETENTION_DAYS = 7;

// JS-08 (#937): decision + assistant-response bounds (approved plan
// 2026-07-11-js-08-opportunity-feed, Coordinator flag rulings 1 & 5).
// Owner-private decide reason — never echoed in responses, errors, or logs.
export const DECISION_REASON_MAX_BYTES = 500;
// The REST invoke path degrades any tool result whose rendered form exceeds
// 16,000 chars to a bare {text} (boundedAssistantToolResultData), destroying
// the structured response the web UI needs — budget with margin below it.
export const RESPONSE_BUDGET_BYTES = 14_000;
export const LIST_LIMIT_DEFAULT = 10;
export const LIST_LIMIT_MAX = 15;
export const LIST_TEXT_MAX_BYTES = 160; // title/evidence/gap caps in list cards
export const DETAIL_EVIDENCE_MAX_ITEMS = 6;
export const DETAIL_TEXT_MAX_BYTES = 240; // per evidence/gap/blocker/unknown/pref string
export const DETAIL_SUMMARY_MAX_BYTES = 800;

// User-facing rejection copy for oversized resume input — exact wording is
// part of the spec contract (asserted verbatim in tests; JS-03 surfaces it).
export const RESUME_TOO_LARGE_MESSAGE =
  "Resume text is over the 48 KB limit (49,152 bytes of UTF-8). Trim it and paste it again.";
