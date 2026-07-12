// tests/unit/external-module-job-search-kv-decisions.test.ts
//
// JS-08 (#937) Task 1: decideOpportunity domain. Decisions are the user's
// word: they must update status/statusAt atomically with the bounded
// owner-private reason, rebuild the feed so readers see the new status
// without waiting for a monitor run, and survive content-refresh upserts
// (the adapter never clobbers a user decision — JS-02 invariant, re-asserted
// here with the new decisionReason field). Oversized reasons are rejected
// BEFORE any write, and a fresh decision without a reason clears a stored
// one — stale rationale on a flipped decision would misattribute intent.
import { describe, expect, it } from "vitest";

import { decideOpportunity } from "../../external-modules/job-search/src/domain/decisions.js";
import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import { readFeed, rebuildFeed } from "../../external-modules/job-search/src/domain/feed.js";
import { DECISION_REASON_MAX_BYTES } from "../../external-modules/job-search/src/domain/limits.js";
import type { OpportunityInput } from "../../external-modules/job-search/src/domain/opportunities.js";
import {
  getOpportunity,
  upsertOpportunity
} from "../../external-modules/job-search/src/domain/opportunities.js";
import { opportunityIdentity } from "../../external-modules/job-search/src/domain/keys.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

const NOW = new Date("2026-07-11T12:00:00.000Z");
const LATER = new Date("2026-07-11T13:00:00.000Z");

function input(externalId: string, description = "Build things."): OpportunityInput {
  return {
    adapterId: "greenhouse",
    externalId,
    posting: { title: "Engineer", company: "Acme", description }
  };
}

function hashOf(externalId: string): string {
  return opportunityIdentity({ adapterId: "greenhouse", externalId });
}

describe("decideOpportunity", () => {
  it("saved: sets status/statusAt/decisionReason and rebuilds the feed", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input("job-a"), NOW);
    await rebuildFeed(kv, NOW);

    const updated = await decideOpportunity(kv, hashOf("job-a"), "saved", "great team", LATER);
    expect(updated.status).toBe("saved");
    expect(updated.statusAt).toBe(LATER.toISOString());
    expect(updated.decisionReason).toBe("great team");

    const stored = await getOpportunity(kv, hashOf("job-a"));
    expect(stored?.status).toBe("saved");
    expect(stored?.decisionReason).toBe("great team");

    // Feed index reflects the decision immediately — no monitor run needed.
    const feed = await readFeed(kv);
    const entry = feed?.entries.find((e) => e.h === hashOf("job-a"));
    expect(entry?.s).toBe("saved");
  });

  it("a fresh decision without a reason clears the previously stored reason", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input("job-b"), NOW);
    await decideOpportunity(kv, hashOf("job-b"), "saved", "great team", NOW);

    const updated = await decideOpportunity(kv, hashOf("job-b"), "passed", undefined, LATER);
    expect(updated.status).toBe("passed");
    expect(updated.decisionReason).toBeUndefined();
    const stored = await getOpportunity(kv, hashOf("job-b"));
    expect(stored !== null && "decisionReason" in stored).toBe(false);
  });

  it("throws missing_record for an unknown hash", async () => {
    const kv = createMemoryKv();
    await expect(
      decideOpportunity(kv, "0".repeat(32), "saved", undefined, NOW)
    ).rejects.toMatchObject({ name: "JobSearchKvError", code: "missing_record" });
  });

  it("rejects an oversized reason before writing anything", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input("job-c"), NOW);

    // Multi-byte payload: the cap is bytes of UTF-8, not chars.
    const oversized = "é".repeat(DECISION_REASON_MAX_BYTES); // 2 bytes each → over cap
    let thrown: unknown;
    try {
      await decideOpportunity(kv, hashOf("job-c"), "saved", oversized, LATER);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(JobSearchKvError);
    expect((thrown as JobSearchKvError).code).toBe("invalid_record");
    // Scrubbed error: names the key + cap, never the submitted value.
    expect((thrown as JobSearchKvError).message).not.toContain("é");

    const stored = await getOpportunity(kv, hashOf("job-c"));
    expect(stored?.status).toBe("new"); // nothing written
    expect(stored !== null && "decisionReason" in stored).toBe(false);
  });

  it("survives a content-refresh upsert (status, statusAt AND decisionReason preserved)", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input("job-d"), NOW);
    await decideOpportunity(kv, hashOf("job-d"), "saved", "strong fit", NOW);

    // Same identity, changed content → posting refresh path.
    await upsertOpportunity(kv, input("job-d", "New responsibilities."), LATER);

    const stored = await getOpportunity(kv, hashOf("job-d"));
    expect(stored?.posting.description).toBe("New responsibilities.");
    expect(stored?.status).toBe("saved");
    expect(stored?.statusAt).toBe(NOW.toISOString());
    expect(stored?.decisionReason).toBe("strong fit");
  });
});
