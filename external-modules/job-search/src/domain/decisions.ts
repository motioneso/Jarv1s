// external-modules/job-search/src/domain/decisions.ts
//
// JS-08 (#937): confirm-gated opportunity decisions. Lives OUTSIDE
// opportunities.ts because it must rebuild the feed after the status write
// and feed.ts already imports opportunities.ts — importing feed.ts back from
// there would cycle (retention.ts precedent: compose both from a third file).
//
// A decision is the user's word: status + statusAt + the bounded
// owner-private reason move together, and the feed index is rebuilt in the
// same call so readers see the new status without waiting for a monitor run.
// The reason is validated BEFORE any write (an oversized reason must not
// half-apply the decision) and is deliberately cleared when a fresh decision
// arrives without one — stale rationale on a flipped decision would
// misattribute intent. Saved/passed protection and eviction behavior are
// JS-02 retention rules and come for free from the status value.
import { JobSearchKvError } from "./errors.js";
import { rebuildFeed } from "./feed.js";
import { keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import { DECISION_REASON_MAX_BYTES } from "./limits.js";
import type { OpportunityRecord } from "./opportunities.js";
import { assertHash } from "./opportunities.js";
import { readRecord, writeRecord } from "./records.js";

export type OpportunityDecision = "saved" | "passed";

// Exported for the decide handler's enum validation (Task 4).
export const OPPORTUNITY_DECISIONS: readonly OpportunityDecision[] = ["saved", "passed"];

/**
 * Apply a user decision: update status/statusAt, set (or clear, when absent)
 * the owner-private decisionReason, then rebuild the feed index. Returns the
 * updated record.
 */
export async function decideOpportunity(
  kv: JobSearchKv,
  identityHash: string,
  decision: OpportunityDecision,
  reason: string | undefined,
  now: Date
): Promise<OpportunityRecord> {
  assertHash(identityHash);
  if (reason !== undefined && Buffer.byteLength(reason, "utf8") > DECISION_REASON_MAX_BYTES) {
    // Scrubbed: names the key + cap only, never the submitted text.
    throw new JobSearchKvError(
      "invalid_record",
      `decisionReason exceeds ${DECISION_REASON_MAX_BYTES} bytes of UTF-8`
    );
  }
  const existing = (await readRecord(
    kv,
    NS.opportunities,
    keys.job(identityHash)
  )) as OpportunityRecord | null;
  if (existing === null) {
    throw new JobSearchKvError("missing_record", "opportunity not found for decision");
  }
  // Rebuild the record without a stale reason rather than spreading over it:
  // reason-absent means "no rationale for THIS decision", not "keep the old".
  const { decisionReason: _dropped, ...rest } = existing;
  const record: OpportunityRecord = {
    ...rest,
    status: decision,
    statusAt: now.toISOString(),
    ...(reason !== undefined ? { decisionReason: reason } : {})
  };
  await writeRecord(kv, NS.opportunities, keys.job(identityHash), record);
  await rebuildFeed(kv, now);
  return record;
}
