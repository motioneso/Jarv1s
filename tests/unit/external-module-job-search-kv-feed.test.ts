// tests/unit/external-module-job-search-kv-feed.test.ts
//
// JS-02 (#931) Task 8: feed index. The feed is DERIVED state — rebuilt from
// job/* canonical records, never a source of truth — so a corrupt index is
// detected (corrupt_index), recoverable (readFeedOrRebuild), and an
// interrupted upsert+rebuild flow converges on retry without losing a
// posting.
import { describe, expect, it } from "vitest";

import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import {
  readFeed,
  readFeedOrRebuild,
  rebuildFeed
} from "../../external-modules/job-search/src/domain/feed.js";
import type { OpportunityInput } from "../../external-modules/job-search/src/domain/opportunities.js";
import { upsertOpportunity } from "../../external-modules/job-search/src/domain/opportunities.js";
import { keys, opportunityIdentity } from "../../external-modules/job-search/src/domain/keys.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";
import type { MemoryKv } from "./helpers/job-search-memory-kv.js";

const REBUILT_AT = new Date("2026-07-11T12:00:00.000Z");

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

async function seedThree(kv: MemoryKv): Promise<void> {
  await upsertOpportunity(kv, input("j1"), new Date("2026-07-09T09:00:00.000Z"));
  await upsertOpportunity(kv, input("j2"), new Date("2026-07-11T09:00:00.000Z"));
  await upsertOpportunity(kv, input("j3"), new Date("2026-07-10T09:00:00.000Z"));
}

describe("feed index", () => {
  it("rebuilds from canonical jobs, newest lastSeenAt first, compact entries only", async () => {
    const kv = createMemoryKv();
    await seedThree(kv);
    await rebuildFeed(kv, REBUILT_AT);

    const feed = await readFeed(kv);
    expect(feed?.rebuiltAt).toBe(REBUILT_AT.toISOString());
    expect(feed?.entries.map((e) => e.h)).toEqual([hashOf("j2"), hashOf("j3"), hashOf("j1")]);
    for (const entry of feed?.entries ?? []) {
      // {h, r, s} and NOTHING else — no titles/companies in the index.
      expect(Object.keys(entry).sort()).toEqual(["h", "r", "s"]);
      expect(entry.s).toBe("new");
    }
  });

  it("returns null when no feed has been built", async () => {
    const kv = createMemoryKv();
    expect(await readFeed(kv)).toBeNull();
  });

  it("throws corrupt_index on an unreadable stored index", async () => {
    const kv = createMemoryKv();
    // Garbage planted directly: wrong shape entirely.
    await kv.set(NS.feed, keys.feedActive, { schemaVersion: 1, entries: "not-an-array" });
    const error = await readFeed(kv).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(JobSearchKvError);
    expect((error as JobSearchKvError).code).toBe("corrupt_index");
  });

  it("maps invalid stored envelopes to corrupt_index too", async () => {
    const kv = createMemoryKv();
    await kv.set(NS.feed, keys.feedActive, { schemaVersion: 99 });
    const error = await readFeed(kv).then(
      () => null,
      (e: unknown) => e
    );
    expect((error as JobSearchKvError).code).toBe("corrupt_index");
  });

  it("readFeedOrRebuild recovers from a corrupt index", async () => {
    const kv = createMemoryKv();
    await seedThree(kv);
    await kv.set(NS.feed, keys.feedActive, { schemaVersion: 1, entries: 42 });

    const feed = await readFeedOrRebuild(kv, REBUILT_AT);
    expect(feed.entries).toHaveLength(3);
    // The repaired index is persisted, not just returned.
    expect((await readFeed(kv))?.entries).toHaveLength(3);
  });

  it("readFeedOrRebuild builds a fresh index when none exists", async () => {
    const kv = createMemoryKv();
    await seedThree(kv);
    const feed = await readFeedOrRebuild(kv, REBUILT_AT);
    expect(feed.entries).toHaveLength(3);
  });

  it("interrupted upsert-then-rebuild converges on retry (no posting lost)", async () => {
    const clean = createMemoryKv();
    await seedThree(clean);
    await upsertOpportunity(clean, input("j4"), new Date("2026-07-11T10:00:00.000Z"));
    await rebuildFeed(clean, REBUILT_AT);

    const kv = createMemoryKv();
    await seedThree(kv);
    // Fail the 2nd set: the canonical job write (set 1) lands, the derived
    // feed-index write (set 2) dies mid-flow — canonical-first ordering means
    // nothing is lost, only the index is stale.
    kv.failAfterSets(2);
    await expect(
      (async () => {
        await upsertOpportunity(kv, input("j4"), new Date("2026-07-11T10:00:00.000Z"));
        await rebuildFeed(kv, REBUILT_AT);
      })()
    ).rejects.toThrow();

    // Retry the whole flow — must converge to the clean run, byte for byte.
    await upsertOpportunity(kv, input("j4"), new Date("2026-07-11T10:00:00.000Z"));
    await rebuildFeed(kv, REBUILT_AT);
    expect(kv.dump()).toEqual(clean.dump());
  });
});
