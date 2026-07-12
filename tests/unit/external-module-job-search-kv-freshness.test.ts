// tests/unit/external-module-job-search-kv-freshness.test.ts
//
// JS-07 (#936) Step 2: freshness transitions. The pass runs ONLY after a
// successful fetch (fetch failure never implies stale — spec §identity), is
// scoped to one (adapterId, board) sourceKey so monitors sharing an adapter
// never contaminate each other, and never clobbers saved/active user
// decisions. Records without a sourceKey read as "uncertain" and are left
// alone until a stamping monitor re-sees them.
import { describe, expect, it } from "vitest";

import {
  freshnessOf,
  markFreshnessAfterRun,
  transitionFreshness
} from "../../external-modules/job-search/src/domain/freshness.js";
import {
  opportunityIdentity,
  sourceKey
} from "../../external-modules/job-search/src/domain/keys.js";
import type {
  OpportunityInput,
  OpportunityStatus
} from "../../external-modules/job-search/src/domain/opportunities.js";
import {
  getOpportunity,
  setOpportunityStatus,
  upsertOpportunity
} from "../../external-modules/job-search/src/domain/opportunities.js";
import { createMemoryKv, type MemoryKv } from "./helpers/job-search-memory-kv.js";

const T0 = new Date("2026-07-11T09:00:00.000Z");
const T1 = new Date("2026-07-11T12:00:00.000Z");

const SRC_A = sourceKey("greenhouse", "acme");
const SRC_B = sourceKey("greenhouse", "other");

function hashOf(externalId: string): string {
  return opportunityIdentity({ adapterId: "greenhouse", externalId });
}

async function seed(
  kv: MemoryKv,
  externalId: string,
  opts: { sourceKey?: string; status?: OpportunityStatus } = {}
): Promise<string> {
  const input: OpportunityInput = {
    adapterId: "greenhouse",
    externalId,
    ...(opts.sourceKey !== undefined ? { sourceKey: opts.sourceKey } : {}),
    posting: {
      title: `Job ${externalId}`,
      company: "Acme",
      description: "Build things."
    }
  };
  await upsertOpportunity(kv, input, T0);
  const hash = hashOf(externalId);
  if (opts.status !== undefined) {
    await setOpportunityStatus(kv, hash, opts.status, T0);
  }
  return hash;
}

describe("freshness pass (JS-07)", () => {
  it("seen records become active with lastLivenessAt = now", async () => {
    const kv = createMemoryKv();
    const hash = await seed(kv, "job-1", { sourceKey: SRC_A });
    const counts = await markFreshnessAfterRun(kv, {
      sourceKey: SRC_A,
      seenIdentityHashes: new Set([hash]),
      now: T1
    });
    const record = await getOpportunity(kv, hash);
    expect(record?.freshness).toBe("active");
    expect(record?.lastLivenessAt).toBe(T1.toISOString());
    expect(record?.status).toBe("new");
    expect(counts).toMatchObject({ activeMarked: 1, staleMarked: 0 });
  });

  it("unseen same-source records go stale; new/passed statuses become stale", async () => {
    const kv = createMemoryKv();
    const fresh = await seed(kv, "job-1", { sourceKey: SRC_A });
    const gone = await seed(kv, "job-2", { sourceKey: SRC_A });
    const passed = await seed(kv, "job-3", { sourceKey: SRC_A, status: "passed" });
    const counts = await markFreshnessAfterRun(kv, {
      sourceKey: SRC_A,
      seenIdentityHashes: new Set([fresh]),
      now: T1
    });
    const goneRecord = await getOpportunity(kv, gone);
    expect(goneRecord?.freshness).toBe("stale");
    expect(goneRecord?.status).toBe("stale");
    expect(goneRecord?.statusAt).toBe(T1.toISOString());
    const passedRecord = await getOpportunity(kv, passed);
    expect(passedRecord?.freshness).toBe("stale");
    expect(passedRecord?.status).toBe("stale");
    expect(counts).toMatchObject({ activeMarked: 1, staleMarked: 2 });
  });

  it("never clobbers saved/active user decisions (freshness still recorded)", async () => {
    const kv = createMemoryKv();
    const saved = await seed(kv, "job-1", { sourceKey: SRC_A, status: "saved" });
    const active = await seed(kv, "job-2", { sourceKey: SRC_A, status: "active" });
    await markFreshnessAfterRun(kv, {
      sourceKey: SRC_A,
      seenIdentityHashes: new Set<string>(),
      now: T1
    });
    const savedRecord = await getOpportunity(kv, saved);
    expect(savedRecord?.freshness).toBe("stale");
    expect(savedRecord?.status).toBe("saved");
    expect(savedRecord?.statusAt).toBe(T0.toISOString());
    const activeRecord = await getOpportunity(kv, active);
    expect(activeRecord?.freshness).toBe("stale");
    expect(activeRecord?.status).toBe("active");
  });

  it("cross-monitor non-contamination: another board's records are untouched", async () => {
    const kv = createMemoryKv();
    const otherBoard = await seed(kv, "job-9", { sourceKey: SRC_B });
    await markFreshnessAfterRun(kv, {
      sourceKey: SRC_A,
      seenIdentityHashes: new Set<string>(),
      now: T1
    });
    const record = await getOpportunity(kv, otherBoard);
    expect(record?.freshness).toBeUndefined();
    expect(record?.status).toBe("new");
    expect(freshnessOf(record!)).toBe("uncertain");
  });

  it("records with no sourceKey stay uncertain and untouched", async () => {
    const kv = createMemoryKv();
    const unbound = await seed(kv, "job-8");
    await markFreshnessAfterRun(kv, {
      sourceKey: SRC_A,
      seenIdentityHashes: new Set<string>(),
      now: T1
    });
    const record = await getOpportunity(kv, unbound);
    expect(record?.freshness).toBeUndefined();
    expect(freshnessOf(record!)).toBe("uncertain");
  });

  it("is idempotent: a second identical pass changes nothing further", async () => {
    const kv = createMemoryKv();
    const fresh = await seed(kv, "job-1", { sourceKey: SRC_A });
    await seed(kv, "job-2", { sourceKey: SRC_A });
    const ctx = { sourceKey: SRC_A, seenIdentityHashes: new Set([fresh]), now: T1 };
    await markFreshnessAfterRun(kv, ctx);
    const counts = await markFreshnessAfterRun(kv, ctx);
    // Seen records refresh liveness (same now → same bytes); stale stays stale.
    expect(counts).toMatchObject({ staleMarked: 0 });
  });

  it("transitionFreshness is pure: returns null when nothing changes", async () => {
    const kv = createMemoryKv();
    const hash = await seed(kv, "job-1", { sourceKey: SRC_A });
    const record = (await getOpportunity(kv, hash))!;
    // Unrelated source, unseen: no transition applies.
    expect(
      transitionFreshness(record, {
        sourceKey: SRC_B,
        seenIdentityHashes: new Set<string>(),
        now: T1
      })
    ).toBeNull();
    // Same source, unseen: stale transition (does not mutate its input).
    const next = transitionFreshness(record, {
      sourceKey: SRC_A,
      seenIdentityHashes: new Set<string>(),
      now: T1
    });
    expect(next?.freshness).toBe("stale");
    expect(record.freshness).toBeUndefined();
  });
});
