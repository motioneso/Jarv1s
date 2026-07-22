// external-modules/job-search/src/domain/freshness.ts
//
// JS-07 (#936) Step 2: freshness transitions. Absence-from-fetch is only
// meaningful per (adapterId, board) — two monitors can share one adapter —
// so the pass is scoped to a single sourceKey and touches nothing bound to
// another board or to no board at all. Callers invoke it ONLY after a
// successful fetch: fetch failure never implies stale (spec §identity;
// JS-05's failure path records the error without touching opportunities).
import { keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import type { OpportunityRecord } from "./opportunities.js";
import { listOpportunities } from "./opportunities.js";
import { writeRecord } from "./records.js";

export type Freshness = "active" | "uncertain" | "stale";

/** Pre-JS-07 records (and anything never liveness-checked) read as uncertain. */
export function freshnessOf(record: OpportunityRecord): Freshness {
  return record.freshness ?? "uncertain";
}

export interface FreshnessRunContext {
  /** sourceKey of the board this run successfully fetched. */
  readonly sourceKey: string;
  /** Identity hashes present in that fetch. */
  readonly seenIdentityHashes: ReadonlySet<string>;
  readonly now: Date;
  /**
   * JS-10 (#1229) broad-discovery carve-out. A board watch enumerates ONE
   * company's live listings, so a record absent from the fetch is genuinely
   * gone → stale. A broad SEARCH returns only the top-N of a moving window
   * (spec §6.5), so absence means "fell out of this window", NOT "posting
   * closed" — marking those stale would wrongly retire live opportunities.
   * Default true preserves board behavior; broad runs pass false, which keeps
   * seen → active but suppresses the unseen → stale transition entirely.
   */
  readonly absenceImpliesClosure?: boolean;
}

/**
 * Pure per-record transition; returns the updated record or null when the
 * run says nothing about this record. Seen → active (+ liveness timestamp).
 * Unseen but bound to THIS run's board → stale; the status auto-follows only
 * from machine-owned states (new/passed) — saved/active are user decisions
 * and are never clobbered. Everything else (other board, no sourceKey) is
 * out of scope for this run.
 */
export function transitionFreshness(
  record: OpportunityRecord,
  ctx: FreshnessRunContext
): OpportunityRecord | null {
  const nowIso = ctx.now.toISOString();
  if (ctx.seenIdentityHashes.has(record.identityHash)) {
    return { ...record, freshness: "active", lastLivenessAt: nowIso };
  }
  // Broad sources (absenceImpliesClosure === false) never stale on absence:
  // the record simply fell out of the search window, not out of existence.
  if (record.sourceKey === ctx.sourceKey && ctx.absenceImpliesClosure !== false) {
    const staleStatus =
      record.status === "new" || record.status === "passed"
        ? { status: "stale" as const, statusAt: nowIso }
        : {};
    if (record.freshness === "stale" && record.status !== "new" && record.status !== "passed") {
      return null; // already fully stale — nothing to rewrite
    }
    return { ...record, freshness: "stale", ...staleStatus };
  }
  return null;
}

export interface FreshnessCounts {
  activeMarked: number;
  staleMarked: number;
}

/** Apply the transition to every stored opportunity; counts only. */
export async function markFreshnessAfterRun(
  kv: JobSearchKv,
  ctx: FreshnessRunContext
): Promise<FreshnessCounts> {
  let activeMarked = 0;
  let staleMarked = 0;
  for (const record of await listOpportunities(kv)) {
    const next = transitionFreshness(record, ctx);
    if (next === null) {
      continue;
    }
    await writeRecord(kv, NS.opportunities, keys.job(next.identityHash), next);
    if (next.freshness === "active") activeMarked += 1;
    else staleMarked += 1;
  }
  return { activeMarked, staleMarked };
}
