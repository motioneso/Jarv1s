// tests/unit/external-module-job-search-handlers-opportunities.test.ts
//
// JS-08 (#937) Task 2: opportunities.list — bounded feed cards over the
// JS-07 index. The load-bearing rules are the bounds: cards NEVER carry the
// posting description, every free-text field is byte-capped, and the whole
// serialized response stays under RESPONSE_BUDGET_BYTES even at a worst-case
// 15 fully-maxed cards — the REST invoke path silently degrades any larger
// result to a bare {text} (boundedAssistantToolResultData), destroying the
// structure the web UI needs. Because the plan's per-field caps alone cannot
// arithmetically guarantee that at limit 15, the handler carries a budget
// backstop: advisory topEvidence/topGap are stripped from the LAST (lowest
// ranked) cards first until the response fits.
import { describe, expect, it } from "vitest";

import {
  approveProfile,
  approveResume,
  decideOpportunity,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  LIST_TEXT_MAX_BYTES,
  RESPONSE_BUDGET_BYTES,
  evaluationIdentity,
  opportunityIdentity,
  saveEvaluation,
  saveOriginalResume,
  saveProfileRevision,
  setOpportunityStatus,
  upsertOpportunity
} from "../../external-modules/job-search/src/domain/index.js";
import type {
  EvaluationRecord,
  OpportunityInput
} from "../../external-modules/job-search/src/domain/index.js";
import type { WorkerPorts } from "../../external-modules/job-search/src/worker/ai-port.js";
import { listOpportunitiesHandler } from "../../external-modules/job-search/src/worker/handlers/opportunities.js";
import { readInt } from "../../external-modules/job-search/src/worker/validate.js";
import { wrap } from "../../external-modules/job-search/src/worker/wrap.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";
import type { MemoryKv } from "./helpers/job-search-memory-kv.js";

const NOW = new Date("2026-07-11T12:00:00.000Z");

const portsAt = (kv: MemoryKv, now: Date): WorkerPorts => ({
  kv,
  ai: null,
  now: () => now
});

function input(
  externalId: string,
  posting: Partial<OpportunityInput["posting"]> = {}
): OpportunityInput {
  return {
    adapterId: "greenhouse",
    externalId,
    posting: {
      title: "Engineer",
      company: "Acme",
      description: "Build things.",
      ...posting
    }
  };
}

function hashOf(externalId: string): string {
  return opportunityIdentity({ adapterId: "greenhouse", externalId });
}

/** Approved resume revision "0" + profile "p1" — matches rebuildFeed's inputs. */
async function approveBoth(kv: MemoryKv): Promise<void> {
  await saveOriginalResume(kv, "Line one", NOW);
  await approveResume(kv, "0", NOW);
  await saveProfileRevision(kv, {
    schemaVersion: 1,
    revisionId: "p1",
    createdAt: NOW.toISOString(),
    provenance: "user",
    fields: { targetTitles: ["Staff Engineer"] }
  });
  await approveProfile(kv, "p1", NOW);
}

/** A CURRENT evaluation for a stored job (inputs match rebuildFeed's check). */
function evalFor(
  identityHash: string,
  contentHash: string,
  overrides: Partial<EvaluationRecord> = {}
): EvaluationRecord {
  const inputs = {
    opportunityContentHash: contentHash,
    profileRevisionId: "p1",
    resumeRevisionId: "0"
  };
  return {
    schemaVersion: 1,
    evaluationId: evaluationIdentity(inputs),
    identityHash,
    fitBand: "strong",
    recommendation: "pursue",
    evidence: [{ requirement: "TypeScript", evidence: "Shipped TS services", source: "resume" }],
    blockers: [],
    gaps: ["No Rust exposure"],
    unknowns: [],
    preferenceMatches: [],
    preferenceConflicts: [],
    postingConfidence: "high",
    overallConfidence: "high",
    summary: "Strong match.",
    inputs,
    createdAt: NOW.toISOString(),
    ...overrides
  };
}

describe("readInt", () => {
  it("returns undefined when absent, throws when required", () => {
    expect(readInt({}, "limit")).toBeUndefined();
    expect(() => readInt({}, "limit", { required: true })).toThrow("limit is required");
  });

  it("rejects non-integers naming key + constraint only", () => {
    expect(() => readInt({ limit: 1.5 }, "limit")).toThrow("limit must be an integer");
    expect(() => readInt({ limit: "10" }, "limit")).toThrow("limit must be an integer");
    expect(() => readInt({ limit: Number.NaN }, "limit")).toThrow("limit must be an integer");
  });

  it("enforces min/max bounds", () => {
    expect(() => readInt({ limit: 0 }, "limit", { min: 1 })).toThrow("limit must be at least 1");
    expect(() => readInt({ limit: 16 }, "limit", { max: 15 })).toThrow("limit must be at most 15");
    expect(readInt({ limit: 15 }, "limit", { min: 1, max: 15 })).toBe(15);
  });
});

describe("opportunities.list", () => {
  it("defaults to view=new with the default limit, preserving feed order", async () => {
    const kv = createMemoryKv();
    // Distinct publishedAt so the JS-07 sort (newest posting first among
    // equal ranks) fixes the order deterministically: job-11 is newest.
    for (let i = 0; i < 12; i += 1) {
      await upsertOpportunity(
        kv,
        input(`job-${i}`, { publishedAt: `2026-07-${String(i + 1).padStart(2, "0")}` }),
        NOW
      );
    }
    const result = await listOpportunitiesHandler(portsAt(kv, NOW))({});
    expect(result.status).toBe("ok");
    expect(result.view).toBe("new");
    expect(result.total).toBe(12);
    expect(result.limit).toBe(LIST_LIMIT_DEFAULT);
    expect(result.offset).toBe(0);
    const cards = result.opportunities as Array<Record<string, unknown>>;
    expect(cards).toHaveLength(LIST_LIMIT_DEFAULT);
    expect(cards[0]).toMatchObject({
      identityHash: hashOf("job-11"),
      status: "new",
      title: "Engineer",
      company: "Acme",
      source: "greenhouse",
      publishedAt: "2026-07-12",
      firstSeenAt: NOW.toISOString(),
      freshness: "uncertain",
      evaluationPending: true
    });
    // No approved profile → no gate verdict on the card.
    expect("eligibility" in cards[0]!).toBe(false);
  });

  it("saved view includes active records; other statuses stay out", async () => {
    const kv = createMemoryKv();
    for (const id of ["job-a", "job-b", "job-c", "job-d"]) {
      await upsertOpportunity(kv, input(id), NOW);
    }
    await decideOpportunity(kv, hashOf("job-a"), "saved", undefined, NOW);
    await setOpportunityStatus(kv, hashOf("job-b"), "active", NOW);
    await decideOpportunity(kv, hashOf("job-c"), "passed", undefined, NOW);

    const result = await listOpportunitiesHandler(portsAt(kv, NOW))({ view: "saved" });
    expect(result.total).toBe(2);
    const hashes = (result.opportunities as Array<{ identityHash: string }>).map(
      (c) => c.identityHash
    );
    expect(hashes).toContain(hashOf("job-a"));
    expect(hashes).toContain(hashOf("job-b"));
    expect(hashes).not.toContain(hashOf("job-c"));
    expect(hashes).not.toContain(hashOf("job-d"));
  });

  it("paginates within the view while total reports the full view count", async () => {
    const kv = createMemoryKv();
    for (let i = 0; i < 5; i += 1) {
      await upsertOpportunity(kv, input(`job-${i}`, { publishedAt: `2026-07-0${i + 1}` }), NOW);
    }
    const handler = listOpportunitiesHandler(portsAt(kv, NOW));
    const all = await handler({ limit: 5 });
    const page = await handler({ offset: 2, limit: 2 });
    expect(page.total).toBe(5);
    expect(page.offset).toBe(2);
    const allHashes = (all.opportunities as Array<{ identityHash: string }>).map(
      (c) => c.identityHash
    );
    const pageHashes = (page.opportunities as Array<{ identityHash: string }>).map(
      (c) => c.identityHash
    );
    expect(pageHashes).toEqual(allHashes.slice(2, 4));
  });

  it("rejects limit above LIST_LIMIT_MAX and negative offset via the error envelope", async () => {
    const kv = createMemoryKv();
    const handler = wrap(listOpportunitiesHandler(portsAt(kv, NOW)));
    const overLimit = await handler({ limit: LIST_LIMIT_MAX + 1 });
    expect(overLimit).toMatchObject({ status: "error", code: "invalid_input" });
    expect(String(overLimit.message)).toContain("limit");
    const negative = await handler({ offset: -1 });
    expect(negative).toMatchObject({ status: "error", code: "invalid_input" });
  });

  it("never includes the posting description anywhere in the response", async () => {
    const kv = createMemoryKv();
    const marker = "SECRET-DESCRIPTION-MARKER-93a1";
    await upsertOpportunity(kv, input("job-a", { description: `Body ${marker} tail.` }), NOW);
    const result = await listOpportunitiesHandler(portsAt(kv, NOW))({});
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("pending evaluation ⇒ evaluationPending true with no band/evidence fields", async () => {
    const kv = createMemoryKv();
    await approveBoth(kv);
    await upsertOpportunity(kv, input("job-a"), NOW);
    const result = await listOpportunitiesHandler(portsAt(kv, NOW))({});
    const card = (result.opportunities as Array<Record<string, unknown>>)[0]!;
    expect(card.eligibility).toBe("eligible"); // gate ran (profile approved)
    expect(card.evaluationPending).toBe(true);
    for (const key of ["fitBand", "confidence", "topEvidence", "topGap"]) {
      expect(key in card).toBe(false);
    }
  });

  it("current evaluation ⇒ decoded band/confidence + capped top evidence/gap", async () => {
    const kv = createMemoryKv();
    await approveBoth(kv);
    const upserted = await upsertOpportunity(kv, input("job-a"), NOW);
    if (upserted.suppressed) throw new Error("unexpected tombstone");
    await saveEvaluation(kv, evalFor(hashOf("job-a"), upserted.record.contentHash));
    const result = await listOpportunitiesHandler(portsAt(kv, NOW))({});
    const card = (result.opportunities as Array<Record<string, unknown>>)[0]!;
    expect(card).toMatchObject({
      eligibility: "eligible",
      fitBand: "strong",
      confidence: "high",
      evaluationPending: false,
      topEvidence: "Shipped TS services",
      topGap: "No Rust exposure"
    });
  });

  it("caps every free-text card field on a UTF-8 byte boundary", async () => {
    const kv = createMemoryKv();
    await approveBoth(kv);
    const upserted = await upsertOpportunity(
      kv,
      input("job-a", {
        title: "T".repeat(400),
        company: "C".repeat(300),
        location: "L".repeat(400)
      }),
      NOW
    );
    if (upserted.suppressed) throw new Error("unexpected tombstone");
    await saveEvaluation(
      kv,
      evalFor(hashOf("job-a"), upserted.record.contentHash, {
        evidence: [{ requirement: "R", evidence: "E".repeat(400), source: "resume" }],
        gaps: ["G".repeat(400)]
      })
    );
    const result = await listOpportunitiesHandler(portsAt(kv, NOW))({});
    const card = (result.opportunities as Array<Record<string, string>>)[0]!;
    expect(Buffer.byteLength(card.title!, "utf8")).toBeLessThanOrEqual(LIST_TEXT_MAX_BYTES);
    expect(Buffer.byteLength(card.company!, "utf8")).toBeLessThanOrEqual(120);
    expect(Buffer.byteLength(card.location!, "utf8")).toBeLessThanOrEqual(LIST_TEXT_MAX_BYTES);
    expect(Buffer.byteLength(card.topEvidence!, "utf8")).toBeLessThanOrEqual(LIST_TEXT_MAX_BYTES);
    expect(Buffer.byteLength(card.topGap!, "utf8")).toBeLessThanOrEqual(LIST_TEXT_MAX_BYTES);
  });

  it("worst-case 15 maxed cards stay within RESPONSE_BUDGET_BYTES", async () => {
    const kv = createMemoryKv();
    await approveBoth(kv);
    for (let i = 0; i < 15; i += 1) {
      const upserted = await upsertOpportunity(
        kv,
        input(`job-${String(i).padStart(2, "0")}`, {
          title: "T".repeat(400),
          company: "C".repeat(300),
          location: "L".repeat(400),
          workMode: "remote",
          publishedAt: "2026-07-01T00:00:00.000Z",
          description: "D".repeat(2_000)
        }),
        NOW
      );
      if (upserted.suppressed) throw new Error("unexpected tombstone");
      await saveEvaluation(
        kv,
        evalFor(upserted.record.identityHash, upserted.record.contentHash, {
          fitBand: "possible",
          overallConfidence: "medium",
          evidence: [{ requirement: "R", evidence: "E".repeat(400), source: "resume" }],
          gaps: ["G".repeat(400)]
        })
      );
    }
    const result = await listOpportunitiesHandler(portsAt(kv, NOW))({
      limit: LIST_LIMIT_MAX
    });
    const cards = result.opportunities as Array<Record<string, unknown>>;
    expect(cards).toHaveLength(LIST_LIMIT_MAX);
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(
      RESPONSE_BUDGET_BYTES
    );
    // Backstop strips advisory snippets from the TAIL first — the top-ranked
    // card must keep its evidence line.
    expect(typeof cards[0]!.topEvidence).toBe("string");
    // Structured band fields survive the backstop on every card.
    expect(cards.every((c) => c.fitBand === "possible")).toBe(true);
  });

  it("ignores unknown input keys (manifest schema rejects them earlier)", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input("job-a"), NOW);
    const result = await listOpportunitiesHandler(portsAt(kv, NOW))({
      view: "new",
      bogus: "yes"
    });
    expect(result.status).toBe("ok");
  });
});
