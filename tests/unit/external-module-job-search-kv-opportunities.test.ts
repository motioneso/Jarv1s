// tests/unit/external-module-job-search-kv-opportunities.test.ts
//
// JS-02 (#931) Task 7: opportunities repo. Upsert is idempotent on
// (identity, contentHash); user status survives content refreshes; an
// unexpired tombstone suppresses re-ingestion so evicted postings don't
// bounce back on the next monitor run; oversized descriptions truncate on a
// UTF-8 boundary instead of rejecting the posting.
import { describe, expect, it } from "vitest";

import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import { DESCRIPTION_MAX_BYTES } from "../../external-modules/job-search/src/domain/limits.js";
import { opportunityIdentity } from "../../external-modules/job-search/src/domain/keys.js";
import type { OpportunityInput } from "../../external-modules/job-search/src/domain/opportunities.js";
import {
  getOpportunity,
  listOpportunities,
  setOpportunityStatus,
  upsertOpportunity
} from "../../external-modules/job-search/src/domain/opportunities.js";
import { keys } from "../../external-modules/job-search/src/domain/keys.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

const T0 = new Date("2026-07-11T09:00:00.000Z");
const T1 = new Date("2026-07-11T12:00:00.000Z");

function input(description = "Build things."): OpportunityInput {
  return {
    adapterId: "greenhouse",
    externalId: "job-42",
    posting: {
      title: "Engineer",
      company: "Acme",
      url: "https://example.com/job-42",
      description
    }
  };
}

const HASH = opportunityIdentity({ adapterId: "greenhouse", externalId: "job-42" });

describe("opportunities repo", () => {
  it("creates a new record with status new and matching timestamps", async () => {
    const kv = createMemoryKv();
    const result = await upsertOpportunity(kv, input(), T0);
    expect(result.suppressed).toBe(false);
    const record = await getOpportunity(kv, HASH);
    expect(record).not.toBeNull();
    expect(record?.status).toBe("new");
    expect(record?.identityHash).toBe(HASH);
    expect(record?.firstSeenAt).toBe(T0.toISOString());
    expect(record?.lastSeenAt).toBe(T0.toISOString());
    expect(record?.posting.descriptionTruncated).toBe(false);
  });

  it("truncates an oversized description on a UTF-8 boundary and flags it", async () => {
    // 16_383 ASCII bytes + one 2-byte char = 16_385 bytes; the cut at 16_384
    // would split the é, so truncation must back off to 16_383 clean bytes.
    const description = "a".repeat(DESCRIPTION_MAX_BYTES - 1) + "é";
    expect(Buffer.byteLength(description, "utf8")).toBe(DESCRIPTION_MAX_BYTES + 1);

    const kv = createMemoryKv();
    await upsertOpportunity(kv, input(description), T0);
    const record = await getOpportunity(kv, HASH);
    const stored = record?.posting.description as string;
    expect(Buffer.byteLength(stored, "utf8")).toBeLessThanOrEqual(DESCRIPTION_MAX_BYTES);
    expect(stored).toBe("a".repeat(DESCRIPTION_MAX_BYTES - 1)); // no mangled tail char
    expect(record?.posting.descriptionTruncated).toBe(true);
  });

  it("is idempotent for a retry with identical content (lastSeenAt refreshes)", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input(), T0);
    await upsertOpportunity(kv, input(), T1);
    const record = await getOpportunity(kv, HASH);
    expect(record?.firstSeenAt).toBe(T0.toISOString());
    expect(record?.status).toBe("new");
    expect(record?.statusAt).toBe(T0.toISOString());
    expect(record?.lastSeenAt).toBe(T1.toISOString());
  });

  it("updates posting on content change but preserves user status", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input("Old text"), T0);
    await setOpportunityStatus(kv, HASH, "saved", T0);

    await upsertOpportunity(kv, input("New text"), T1);
    const record = await getOpportunity(kv, HASH);
    expect(record?.posting.description).toBe("New text");
    expect(record?.status).toBe("saved");
    expect(record?.firstSeenAt).toBe(T0.toISOString());
    expect(record?.lastSeenAt).toBe(T1.toISOString());
  });

  it("suppresses ingestion while a tombstone is unexpired", async () => {
    const kv = createMemoryKv();
    await kv.set(NS.opportunities, keys.tombstone(HASH), {
      schemaVersion: 1,
      identityHash: HASH,
      adapterId: "greenhouse",
      expiresAt: "2026-08-01T00:00:00.000Z" // after T0
    });

    expect(await upsertOpportunity(kv, input(), T0)).toEqual({ suppressed: true });
    expect(await getOpportunity(kv, HASH)).toBeNull();
    // Tombstone stays until it expires.
    expect(await kv.get(NS.opportunities, keys.tombstone(HASH))).not.toBeNull();
  });

  it("deletes an expired tombstone and proceeds with ingestion", async () => {
    const kv = createMemoryKv();
    await kv.set(NS.opportunities, keys.tombstone(HASH), {
      schemaVersion: 1,
      identityHash: HASH,
      adapterId: "greenhouse",
      expiresAt: T0.toISOString() // expiresAt <= now counts as expired
    });

    const result = await upsertOpportunity(kv, input(), T0);
    expect(result.suppressed).toBe(false);
    expect(await kv.get(NS.opportunities, keys.tombstone(HASH))).toBeNull();
    expect((await getOpportunity(kv, HASH))?.status).toBe("new");
  });

  it("lists canonical job records only (tombstones excluded)", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input(), T0);
    await kv.set(NS.opportunities, keys.tombstone("f".repeat(32)), {
      schemaVersion: 1,
      identityHash: "f".repeat(32),
      adapterId: "greenhouse",
      expiresAt: "2026-08-01T00:00:00.000Z"
    });
    const all = await listOpportunities(kv);
    expect(all.map((r) => r.identityHash)).toEqual([HASH]);
  });

  it("rejects setOpportunityStatus on a missing record with missing_record", async () => {
    const kv = createMemoryKv();
    const error = await setOpportunityStatus(kv, "0".repeat(32), "saved", T0).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(JobSearchKvError);
    expect((error as JobSearchKvError).code).toBe("missing_record");
  });

  it("rejects malformed identity hashes", async () => {
    const kv = createMemoryKv();
    const error = await getOpportunity(kv, "not-a-hash").then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(JobSearchKvError);
    expect((error as JobSearchKvError).code).toBe("invalid_record");
  });
});

// JS-07 (#936) Step 1: structured posting facts (publishedAt/workMode/
// employmentType/compensation) + top-level sourceKey ride through the upsert
// as ADDITIVE schemaVersion-1 fields — old records keep reading fine and the
// content hash still covers the full posting object, so a fact change alone
// re-triggers change detection.
describe("opportunities repo — structured posting facts (JS-07)", () => {
  const SOURCE_KEY = "f".repeat(32);

  function factsInput(): OpportunityInput {
    return {
      adapterId: "greenhouse",
      externalId: "job-42",
      sourceKey: SOURCE_KEY,
      posting: {
        title: "Engineer",
        company: "Acme",
        url: "https://example.com/job-42",
        description: "Build things.",
        publishedAt: "2026-07-01T00:00:00.000Z",
        workMode: "remote",
        employmentType: "Full-time",
        compensation: "$100k - $150k"
      }
    };
  }

  it("stores the structured facts and sourceKey on a new record", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, factsInput(), T0);
    const record = await getOpportunity(kv, HASH);
    expect(record?.sourceKey).toBe(SOURCE_KEY);
    expect(record?.posting).toMatchObject({
      publishedAt: "2026-07-01T00:00:00.000Z",
      workMode: "remote",
      employmentType: "Full-time",
      compensation: "$100k - $150k"
    });
  });

  it("content hash is stable across identical upserts (facts included)", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, factsInput(), T0);
    const first = await getOpportunity(kv, HASH);
    await upsertOpportunity(kv, factsInput(), T1);
    const second = await getOpportunity(kv, HASH);
    expect(second?.contentHash).toBe(first?.contentHash);
    // Idempotent path: only the sighting timestamp moved.
    expect(second?.statusAt).toBe(T0.toISOString());
    expect(second?.lastSeenAt).toBe(T1.toISOString());
  });

  it("a fact-only change (same description) changes contentHash but preserves user status", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input(), T0); // plain pre-JS-07 shape
    const before = await getOpportunity(kv, HASH);
    await setOpportunityStatus(kv, HASH, "saved", T0);

    const withFacts = input();
    withFacts.posting.workMode = "remote";
    await upsertOpportunity(kv, withFacts, T1);
    const after = await getOpportunity(kv, HASH);
    expect(after?.contentHash).not.toBe(before?.contentHash);
    expect(after?.posting.workMode).toBe("remote");
    expect(after?.status).toBe("saved");
    expect(after?.firstSeenAt).toBe(T0.toISOString());
  });

  it("old-shape records (no JS-07 fields) read fine and gain sourceKey on unchanged re-sighting", async () => {
    const kv = createMemoryKv();
    // Write a pre-JS-07 record via a plain upsert (no facts, no sourceKey).
    await upsertOpportunity(kv, input(), T0);
    const old = await getOpportunity(kv, HASH);
    expect(old?.sourceKey).toBeUndefined();
    expect(old?.posting.publishedAt).toBeUndefined();

    // Re-seen unchanged, but the monitor now supplies its sourceKey: the
    // idempotent path must attach it without touching contentHash/status.
    const reSeen = input();
    reSeen.sourceKey = SOURCE_KEY;
    await upsertOpportunity(kv, reSeen, T1);
    const record = await getOpportunity(kv, HASH);
    expect(record?.sourceKey).toBe(SOURCE_KEY);
    expect(record?.contentHash).toBe(old?.contentHash);
    expect(record?.status).toBe("new");
  });
});
