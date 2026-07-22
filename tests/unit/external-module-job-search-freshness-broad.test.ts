// tests/unit/external-module-job-search-freshness-broad.test.ts
//
// JS-10 (#1229) Slice 2: the broad-discovery freshness carve-out (spec §6.5).
// A board watch enumerates ONE company's live listings, so a record absent from
// a successful fetch is genuinely gone → stale. A broad SEARCH returns only the
// top-N of a moving window, so absence means "fell out of this window", NOT
// "closed" — staling those would wrongly retire live opportunities. The run
// handler passes absenceImpliesClosure:false for broad runs; this pins that the
// unseen → stale transition is suppressed while seen → active still fires, and
// that board runs (default/true) keep the original staling behavior.
import { describe, expect, it } from "vitest";

import {
  freshnessOf,
  markFreshnessAfterRun
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

const T0 = new Date("2026-07-21T09:00:00.000Z");
const T1 = new Date("2026-07-21T12:00:00.000Z");
const SRC = sourceKey("freehire", "broad");

async function seed(
  kv: MemoryKv,
  externalId: string,
  opts: { status?: OpportunityStatus } = {}
): Promise<string> {
  const input: OpportunityInput = {
    adapterId: "freehire",
    externalId,
    sourceKey: SRC,
    posting: { title: `Job ${externalId}`, company: "Acme", description: "Build things." }
  };
  await upsertOpportunity(kv, input, T0);
  const hash = opportunityIdentity({ adapterId: "freehire", externalId });
  if (opts.status !== undefined) await setOpportunityStatus(kv, hash, opts.status, T0);
  return hash;
}

describe("broad-discovery freshness carve-out (JS-10)", () => {
  it("broad runs mark seen records active but never stale unseen ones", async () => {
    const kv = createMemoryKv();
    const seen = await seed(kv, "job-1");
    const unseen = await seed(kv, "job-2");
    const counts = await markFreshnessAfterRun(kv, {
      sourceKey: SRC,
      seenIdentityHashes: new Set([seen]),
      now: T1,
      absenceImpliesClosure: false
    });

    // Seen → active + liveness stamp, exactly as for a board run.
    const seenRecord = await getOpportunity(kv, seen);
    expect(seenRecord?.freshness).toBe("active");
    expect(seenRecord?.lastLivenessAt).toBe(T1.toISOString());

    // Unseen record fell out of the search window — untouched, NOT stale.
    const unseenRecord = await getOpportunity(kv, unseen);
    expect(unseenRecord?.freshness).toBeUndefined();
    expect(unseenRecord?.status).toBe("new");
    expect(freshnessOf(unseenRecord!)).toBe("uncertain");
    expect(counts).toMatchObject({ activeMarked: 1, staleMarked: 0 });
  });

  it("board runs (default absenceImpliesClosure) still stale unseen records", async () => {
    const kv = createMemoryKv();
    const seen = await seed(kv, "job-1");
    const gone = await seed(kv, "job-2");
    const counts = await markFreshnessAfterRun(kv, {
      sourceKey: SRC,
      seenIdentityHashes: new Set([seen]),
      now: T1
    });
    const goneRecord = await getOpportunity(kv, gone);
    expect(goneRecord?.freshness).toBe("stale");
    expect(goneRecord?.status).toBe("stale");
    expect(counts).toMatchObject({ activeMarked: 1, staleMarked: 1 });
  });
});
