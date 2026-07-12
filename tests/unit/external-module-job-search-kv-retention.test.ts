// tests/unit/external-module-job-search-kv-retention.test.ts
//
// JS-02 (#931) Task 9: retention engine. Fixed `now` throughout — the pass
// takes time as a parameter, never reads the clock. The invariants under
// test: saved/active records are NEVER evicted (overflow is reported, not
// forced); every eviction leaves a compact tombstone BEFORE the job key is
// deleted (interrupted passes re-converge); runs prune to the intersection
// of newest-50 and 14 days; the feed is rebuilt at the end.
import { describe, expect, it } from "vitest";

import {
  EVAL_BUDGET_RETENTION_DAYS,
  OPPORTUNITY_TARGET,
  RUN_RETENTION_MAX,
  TOMBSTONE_TTL_DAYS
} from "../../external-modules/job-search/src/domain/limits.js";
import { readFeed } from "../../external-modules/job-search/src/domain/feed.js";
import type { OpportunityInput } from "../../external-modules/job-search/src/domain/opportunities.js";
import {
  listOpportunities,
  setOpportunityStatus,
  upsertOpportunity
} from "../../external-modules/job-search/src/domain/opportunities.js";
import { recordRun, listRuns } from "../../external-modules/job-search/src/domain/runs.js";
import { runRetentionPass } from "../../external-modules/job-search/src/domain/retention.js";
import { keys, opportunityIdentity } from "../../external-modules/job-search/src/domain/keys.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";
import type { MemoryKv } from "./helpers/job-search-memory-kv.js";

const NOW = new Date("2026-07-11T12:00:00.000Z");
const DAY_MS = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function input(externalId: string): OpportunityInput {
  return {
    adapterId: "greenhouse",
    externalId,
    posting: { title: "Engineer", company: "Acme", description: "Build things." }
  };
}

function hashOf(externalId: string): string {
  return opportunityIdentity({ adapterId: "greenhouse", externalId });
}

async function seedJob(
  kv: MemoryKv,
  externalId: string,
  status: "new" | "saved" | "active" | "passed" | "stale",
  seenAt: Date
): Promise<string> {
  await upsertOpportunity(kv, input(externalId), seenAt);
  if (status !== "new") {
    await setOpportunityStatus(kv, hashOf(externalId), status, seenAt);
  }
  return hashOf(externalId);
}

describe("retention engine", () => {
  it("evicts passed/stale older than 30 days, keeps 29-day-old ones", async () => {
    const kv = createMemoryKv();
    const evictPassed = await seedJob(kv, "old-passed", "passed", daysAgo(31));
    const evictStale = await seedJob(kv, "old-stale", "stale", daysAgo(31));
    const keepPassed = await seedJob(kv, "young-passed", "passed", daysAgo(29));
    const keepNew = await seedJob(kv, "old-new", "new", daysAgo(31)); // age gate is passed/stale only

    const report = await runRetentionPass(kv, NOW);
    expect([...report.evicted].sort()).toEqual([evictPassed, evictStale].sort());
    const remaining = (await listOpportunities(kv)).map((r) => r.identityHash).sort();
    expect(remaining).toEqual([keepPassed, keepNew].sort());
    expect(report.targetMet).toBe(true);
    expect(report.protectedOverflow).toBe(0);
  });

  it("leaves a compact tombstone with exactly the allowed fields, expiring in 60 days", async () => {
    const kv = createMemoryKv();
    const hash = await seedJob(kv, "old-passed", "passed", daysAgo(31));
    await runRetentionPass(kv, NOW);

    const tombstone = await kv.get(NS.opportunities, keys.tombstone(hash));
    expect(tombstone).not.toBeNull();
    // NOTHING else — no title/company/URL/description may survive eviction.
    expect(Object.keys(tombstone!).sort()).toEqual([
      "adapterId",
      "expiresAt",
      "identityHash",
      "schemaVersion"
    ]);
    expect(tombstone!.identityHash).toBe(hash);
    expect(tombstone!.adapterId).toBe("greenhouse");
    expect(tombstone!.expiresAt).toBe(
      new Date(NOW.getTime() + TOMBSTONE_TTL_DAYS * DAY_MS).toISOString()
    );
  });

  it("enforces the 500 cap by evicting oldest-seen unprotected records first", async () => {
    const kv = createMemoryKv();
    const total = OPPORTUNITY_TARGET + 20; // 520
    for (let i = 0; i < total; i += 1) {
      // Strictly increasing lastSeenAt: job-0 is the oldest.
      await upsertOpportunity(kv, input(`job-${i}`), new Date(daysAgo(20).getTime() + i * 60_000));
    }

    const report = await runRetentionPass(kv, NOW);
    expect(report.evicted).toHaveLength(20);
    const oldestTwenty = Array.from({ length: 20 }, (_, i) => hashOf(`job-${i}`)).sort();
    expect([...report.evicted].sort()).toEqual(oldestTwenty);
    expect((await listOpportunities(kv)).length).toBe(OPPORTUNITY_TARGET);
    expect(report.targetMet).toBe(true);
    expect(report.protectedOverflow).toBe(0);
  });

  it("never evicts saved records: overflow is reported, not forced", async () => {
    const kv = createMemoryKv();
    const total = OPPORTUNITY_TARGET + 10; // 510, all saved
    for (let i = 0; i < total; i += 1) {
      await seedJob(kv, `job-${i}`, "saved", new Date(daysAgo(40).getTime() + i * 60_000));
    }

    const report = await runRetentionPass(kv, NOW);
    expect(report.evicted).toEqual([]);
    expect((await listOpportunities(kv)).length).toBe(total);
    expect(report.protectedOverflow).toBe(total);
    expect(report.targetMet).toBe(false);
  });

  it("deletes tombstones at or past their expiry", async () => {
    const kv = createMemoryKv();
    await kv.set(NS.opportunities, keys.tombstone("a".repeat(32)), {
      schemaVersion: 1,
      identityHash: "a".repeat(32),
      adapterId: "greenhouse",
      expiresAt: NOW.toISOString() // expiresAt <= now → expired
    });
    await kv.set(NS.opportunities, keys.tombstone("b".repeat(32)), {
      schemaVersion: 1,
      identityHash: "b".repeat(32),
      adapterId: "greenhouse",
      expiresAt: daysAgo(-1).toISOString() // tomorrow → kept
    });

    const report = await runRetentionPass(kv, NOW);
    expect(report.expiredTombstones).toBe(1);
    expect(await kv.get(NS.opportunities, keys.tombstone("a".repeat(32)))).toBeNull();
    expect(await kv.get(NS.opportunities, keys.tombstone("b".repeat(32)))).not.toBeNull();
  });

  it("prunes runs to the intersection of newest-50 and 14 days, per monitor", async () => {
    const kv = createMemoryKv();
    // 52 recent runs (within 14d) + 3 old ones → keep newest 50 of the
    // recent set, prune 2 recent + 3 old = 5.
    for (let i = 0; i < 52; i += 1) {
      await recordRun(kv, {
        schemaVersion: 1,
        monitorId: "m1",
        runId: `r${String(i).padStart(3, "0")}`,
        startedAt: new Date(daysAgo(13).getTime() + i * 3_600_000).toISOString(),
        status: "ok",
        counts: { fetched: 1 }
      });
    }
    for (let i = 0; i < 3; i += 1) {
      await recordRun(kv, {
        schemaVersion: 1,
        monitorId: "m1",
        runId: `old${i}`,
        startedAt: daysAgo(15 + i).toISOString(),
        status: "ok",
        counts: { fetched: 1 }
      });
    }
    // Another monitor's lone run must be untouched.
    await recordRun(kv, {
      schemaVersion: 1,
      monitorId: "m2",
      runId: "solo",
      startedAt: daysAgo(2).toISOString(),
      status: "ok",
      counts: { fetched: 1 }
    });

    const report = await runRetentionPass(kv, NOW);
    expect(report.prunedRuns).toBe(5);
    const kept = await listRuns(kv, "m1");
    expect(kept).toHaveLength(RUN_RETENTION_MAX);
    expect(kept.every((r) => r.runId.startsWith("r"))).toBe(true);
    expect(await listRuns(kv, "m2")).toHaveLength(1);
    // The latest-run summary stays: it summarizes, it does not reference.
    expect(await kv.get(NS.runs, keys.runLatest("m1"))).not.toBeNull();
  });

  it("rebuilds the feed so evicted hashes disappear from it", async () => {
    const kv = createMemoryKv();
    const evictedHash = await seedJob(kv, "old-passed", "passed", daysAgo(31));
    const keptHash = await seedJob(kv, "fresh", "new", daysAgo(1));

    await runRetentionPass(kv, NOW);
    const feed = await readFeed(kv);
    expect(feed?.entries.map((e) => e.h)).toEqual([keptHash]);
    expect(feed?.entries.some((e) => e.h === evictedHash)).toBe(false);
  });

  it("converges when a prior pass died between tombstone write and job delete", async () => {
    const kv = createMemoryKv();
    const hash = await seedJob(kv, "old-passed", "passed", daysAgo(31));
    // Simulate the interrupted state exactly: tombstone written, job key
    // still present (the pass died before the delete).
    await kv.set(NS.opportunities, keys.tombstone(hash), {
      schemaVersion: 1,
      identityHash: hash,
      adapterId: "greenhouse",
      expiresAt: new Date(NOW.getTime() + TOMBSTONE_TTL_DAYS * DAY_MS).toISOString()
    });

    const report = await runRetentionPass(kv, NOW);
    expect(report.evicted).toEqual([hash]);
    expect(await kv.get(NS.opportunities, keys.job(hash))).toBeNull();
    expect(await kv.get(NS.opportunities, keys.tombstone(hash))).not.toBeNull();
    expect(report.targetMet).toBe(true);
  });
});

// JS-07 (#936) Step 4: evaluations and budget ledgers join the retention
// pass. An evaluation is meaningless without its job, so eviction deletes
// eval/<h> too — ordered tombstone → eval → job so an interrupted pass
// always leaves a state the next pass converges from (job key still present
// re-qualifies the whole sequence).
describe("evaluation + budget retention (JS-07)", () => {
  const budgetDate = (days: number) => daysAgo(days).toISOString().slice(0, 10);

  it("evicting a job deletes its evaluation, eval delete ordered before job delete", async () => {
    const kv = createMemoryKv();
    const hash = await seedJob(kv, "old-passed", "passed", daysAgo(31));
    await kv.set(NS.opportunities, keys.evaluation(hash), {
      schemaVersion: 1,
      identityHash: hash
    });
    // Record the NS.opportunities delete order to pin the convergence
    // invariant: eval/<h> must go before job/<h>.
    const deletions: string[] = [];
    const rawDelete = kv.delete.bind(kv);
    kv.delete = async (namespace, key) => {
      if (namespace === NS.opportunities) {
        deletions.push(key);
      }
      return rawDelete(namespace, key);
    };

    const report = await runRetentionPass(kv, NOW);
    expect(report.evicted).toEqual([hash]);
    expect(await kv.get(NS.opportunities, keys.evaluation(hash))).toBeNull();
    expect(await kv.get(NS.opportunities, keys.job(hash))).toBeNull();
    expect(await kv.get(NS.opportunities, keys.tombstone(hash))).not.toBeNull();
    const evalIndex = deletions.indexOf(keys.evaluation(hash));
    const jobIndex = deletions.indexOf(keys.job(hash));
    expect(evalIndex).toBeGreaterThanOrEqual(0);
    expect(evalIndex).toBeLessThan(jobIndex);
  });

  it("converges when a prior pass died between eval delete and job delete", async () => {
    const kv = createMemoryKv();
    const hash = await seedJob(kv, "old-passed", "passed", daysAgo(31));
    // Interrupted state: tombstone written, eval already deleted (never
    // existed here), job key still present.
    await kv.set(NS.opportunities, keys.tombstone(hash), {
      schemaVersion: 1,
      identityHash: hash,
      adapterId: "greenhouse",
      expiresAt: new Date(NOW.getTime() + TOMBSTONE_TTL_DAYS * DAY_MS).toISOString()
    });

    const report = await runRetentionPass(kv, NOW);
    expect(report.evicted).toEqual([hash]);
    expect(await kv.get(NS.opportunities, keys.job(hash))).toBeNull();
  });

  it("prunes budget ledgers older than the retention window, keeps the boundary day", async () => {
    const kv = createMemoryKv();
    const seedLedger = (date: string, used: number) =>
      kv.set(NS.opportunities, keys.evalBudget(date), { schemaVersion: 1, date, used });
    const prunedDate = budgetDate(EVAL_BUDGET_RETENTION_DAYS + 1);
    const boundaryDate = budgetDate(EVAL_BUDGET_RETENTION_DAYS); // exactly N days old → kept
    const recentDate = budgetDate(2);
    await seedLedger(prunedDate, 25);
    await seedLedger(boundaryDate, 10);
    await seedLedger(recentDate, 3);

    const report = await runRetentionPass(kv, NOW);
    expect(report.prunedBudgets).toBe(1);
    expect(await kv.get(NS.opportunities, keys.evalBudget(prunedDate))).toBeNull();
    expect(await kv.get(NS.opportunities, keys.evalBudget(boundaryDate))).not.toBeNull();
    expect(await kv.get(NS.opportunities, keys.evalBudget(recentDate))).not.toBeNull();
  });

  it("reports zero pruned budgets when no ledgers exist", async () => {
    const kv = createMemoryKv();
    const report = await runRetentionPass(kv, NOW);
    expect(report.prunedBudgets).toBe(0);
  });
});
