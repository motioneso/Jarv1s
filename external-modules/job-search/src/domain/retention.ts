// external-modules/job-search/src/domain/retention.ts
//
// JS-02 (#931): the retention pass. Fixed seven-step order; time is a
// parameter (`now`), never the clock. Invariants: saved/active records are
// NEVER evicted — a protected set past the target is reported as
// protectedOverflow, not forced; every eviction writes its compact tombstone
// BEFORE deleting the job key, so a pass that dies mid-eviction leaves state
// a retry converges from (an existing tombstone never blocks re-eviction of
// a still-present job — the rewrite is byte-identical and the delete simply
// runs again). Cap eviction is TOTAL-count-based (coordinator ruling: a
// non-protected-only threshold breaks mixed cases like 400 saved + 200 new).
import { keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import {
  EVAL_BUDGET_RETENTION_DAYS,
  OPPORTUNITY_TARGET,
  PASSED_STALE_EVICT_DAYS,
  RUN_RETENTION_DAYS,
  RUN_RETENTION_MAX,
  TOMBSTONE_TTL_DAYS
} from "./limits.js";
import { budgetDateFor } from "./evaluations.js";
import { rebuildFeed } from "./feed.js";
import type { OpportunityRecord, OpportunityTombstone } from "./opportunities.js";
import { listOpportunities } from "./opportunities.js";
import { readRecord, writeRecord } from "./records.js";

const DAY_MS = 86_400_000;

export interface RetentionReport {
  evicted: readonly string[];
  expiredTombstones: number;
  prunedRuns: number;
  prunedBudgets: number;
  protectedOverflow: number;
  targetMet: boolean;
}

const TOMBSTONE_PREFIX = "tombstone/";
const RUN_PREFIX = "run/";
const EVAL_BUDGET_PREFIX = "evalBudget/";

/**
 * Tombstone-first eviction: write the compact tombstone, delete the job's
 * evaluation (JS-07 — an evaluation is meaningless without its job), THEN
 * delete the job key. Interrupted anywhere between, the still-present job
 * re-qualifies on the next pass and the whole sequence repeats idempotently
 * (eval delete of an absent key is a no-op).
 */
async function evictOpportunity(
  kv: JobSearchKv,
  record: OpportunityRecord,
  now: Date,
  evicted: string[]
): Promise<void> {
  const tombstone: OpportunityTombstone = {
    schemaVersion: 1,
    identityHash: record.identityHash,
    adapterId: record.adapterId,
    expiresAt: new Date(now.getTime() + TOMBSTONE_TTL_DAYS * DAY_MS).toISOString()
  };
  await writeRecord(kv, NS.opportunities, keys.tombstone(record.identityHash), tombstone);
  await kv.delete(NS.opportunities, keys.evaluation(record.identityHash));
  await kv.delete(NS.opportunities, keys.job(record.identityHash));
  evicted.push(record.identityHash);
}

export async function runRetentionPass(kv: JobSearchKv, now: Date): Promise<RetentionReport> {
  const nowIso = now.toISOString();
  const evicted: string[] = [];

  // Step 1: age-based eviction — passed/stale whose status is older than the
  // window. ISO-8601 compares lexicographically, so string < is date <.
  const ageCutoff = new Date(now.getTime() - PASSED_STALE_EVICT_DAYS * DAY_MS).toISOString();
  for (const record of await listOpportunities(kv)) {
    if ((record.status === "passed" || record.status === "stale") && record.statusAt < ageCutoff) {
      await evictOpportunity(kv, record, now, evicted);
    }
  }

  // Step 2: cap eviction on TOTAL remaining count. saved/active are
  // protected — never evicted, only counted toward the total (which is what
  // can push protectedOverflow past the target).
  const remaining = await listOpportunities(kv);
  const protectedCount = remaining.filter(
    (r) => r.status === "saved" || r.status === "active"
  ).length;
  const evictable = remaining
    .filter((r) => r.status !== "saved" && r.status !== "active")
    // Oldest sighting first; hash tie-break keeps the pass deterministic.
    .sort((a, b) =>
      a.lastSeenAt === b.lastSeenAt
        ? a.identityHash < b.identityHash
          ? -1
          : 1
        : a.lastSeenAt < b.lastSeenAt
          ? -1
          : 1
    );
  let total = remaining.length;
  for (const record of evictable) {
    if (total <= OPPORTUNITY_TARGET) {
      break;
    }
    await evictOpportunity(kv, record, now, evicted);
    total -= 1;
  }
  const protectedOverflow = protectedCount > OPPORTUNITY_TARGET ? protectedCount : 0;

  // Step 4: expire tombstones whose suppression window has closed
  // (expiresAt <= now), so the posting may re-ingest on a future run.
  let expiredTombstones = 0;
  for (const key of await kv.list(NS.opportunities)) {
    if (!key.startsWith(TOMBSTONE_PREFIX)) {
      continue;
    }
    const tombstone = await readRecord(kv, NS.opportunities, key);
    if (
      tombstone !== null &&
      typeof tombstone.expiresAt === "string" &&
      tombstone.expiresAt <= nowIso
    ) {
      await kv.delete(NS.opportunities, key);
      expiredTombstones += 1;
    }
  }

  // Step 4b (JS-07): prune stale daily budget ledgers. Strictly-older-than
  // the retention window — the boundary day itself is kept. Date strings are
  // YYYY-MM-DD so lexicographic < is calendar <; the key suffix IS the date
  // (assertId-validated at write), no record read needed.
  const budgetCutoff = budgetDateFor(new Date(now.getTime() - EVAL_BUDGET_RETENTION_DAYS * DAY_MS));
  let prunedBudgets = 0;
  for (const key of await kv.list(NS.opportunities)) {
    if (!key.startsWith(EVAL_BUDGET_PREFIX)) {
      continue;
    }
    if (key.slice(EVAL_BUDGET_PREFIX.length) < budgetCutoff) {
      await kv.delete(NS.opportunities, key);
      prunedBudgets += 1;
    }
  }

  // Step 5: prune run history per monitor to the INTERSECTION of newest-50
  // and the 14-day window. monitor/<id>/latest summaries are never touched —
  // they summarize the last run, they do not reference a retained record.
  const runCutoff = new Date(now.getTime() - RUN_RETENTION_DAYS * DAY_MS).toISOString();
  const runsByMonitor = new Map<string, { key: string; startedAt: string }[]>();
  for (const key of await kv.list(NS.runs)) {
    if (!key.startsWith(RUN_PREFIX)) {
      continue;
    }
    // Key ABI: run/<monitorId>/<runId> — both segments id-validated at write.
    const [, monitorId] = key.split("/");
    const record = await readRecord(kv, NS.runs, key);
    if (monitorId === undefined || record === null || typeof record.startedAt !== "string") {
      continue;
    }
    const group = runsByMonitor.get(monitorId) ?? [];
    group.push({ key, startedAt: record.startedAt });
    runsByMonitor.set(monitorId, group);
  }
  let prunedRuns = 0;
  for (const group of runsByMonitor.values()) {
    group.sort((a, b) =>
      a.startedAt === b.startedAt ? (a.key < b.key ? 1 : -1) : a.startedAt < b.startedAt ? 1 : -1
    );
    for (const [index, run] of group.entries()) {
      if (index < RUN_RETENTION_MAX && run.startedAt > runCutoff) {
        continue;
      }
      await kv.delete(NS.runs, run.key);
      prunedRuns += 1;
    }
  }

  // Steps 6–7: rebuild the derived feed; its entry count IS the final job
  // count, so targetMet needs no extra listing.
  const feed = await rebuildFeed(kv, now);

  return {
    evicted,
    expiredTombstones,
    prunedRuns,
    prunedBudgets,
    protectedOverflow,
    targetMet: feed.entries.length <= OPPORTUNITY_TARGET
  };
}
