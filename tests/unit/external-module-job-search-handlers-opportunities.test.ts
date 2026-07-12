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
  DECISION_REASON_MAX_BYTES,
  DETAIL_EVIDENCE_MAX_ITEMS,
  DETAIL_SUMMARY_MAX_BYTES,
  DETAIL_TEXT_MAX_BYTES,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  LIST_TEXT_MAX_BYTES,
  RESPONSE_BUDGET_BYTES,
  evaluationIdentity,
  getOpportunity,
  readFeed,
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
import {
  decideOpportunityHandler,
  getOpportunityHandler,
  listOpportunitiesHandler
} from "../../external-modules/job-search/src/worker/handlers/opportunities.js";
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
    recommendation: "review",
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

// JS-08 Task 3: opportunities.get — the ONE surface that carries the posting
// description, under a deterministic byte budget. decisionReason exposure is
// per the Coordinator ruling of 2026-07-11: owner-own content, returned by
// get (owner-only read via KV isolation), still barred from logs, errors,
// job payloads, and any non-owner surface.
describe("opportunities.get", () => {
  it("returns the full bounded detail shape, incl. the owner's decisionReason", async () => {
    const kv = createMemoryKv();
    await approveBoth(kv);
    const upserted = await upsertOpportunity(
      kv,
      input("job-a", {
        location: "Remote, US",
        url: "https://example.com/job-a",
        workMode: "remote",
        employmentType: "full-time",
        compensation: "$200k",
        publishedAt: "2026-07-01T00:00:00.000Z",
        description: "Own the platform."
      }),
      NOW
    );
    if (upserted.suppressed) throw new Error("unexpected tombstone");
    await saveEvaluation(kv, evalFor(hashOf("job-a"), upserted.record.contentHash));
    await decideOpportunity(kv, hashOf("job-a"), "saved", "Comp fits the target band", NOW);

    const result = await getOpportunityHandler(portsAt(kv, NOW))({
      identityHash: hashOf("job-a")
    });
    expect(result.status).toBe("ok");
    const opportunity = result.opportunity as Record<string, unknown>;
    expect(opportunity).toMatchObject({
      identityHash: hashOf("job-a"),
      status: "saved",
      statusAt: NOW.toISOString(),
      decisionReason: "Comp fits the target band",
      firstSeenAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      freshness: "uncertain"
    });
    expect(opportunity.posting).toMatchObject({
      title: "Engineer",
      company: "Acme",
      location: "Remote, US",
      url: "https://example.com/job-a",
      workMode: "remote",
      employmentType: "full-time",
      compensation: "$200k",
      publishedAt: "2026-07-01T00:00:00.000Z",
      description: "Own the platform.",
      descriptionTruncated: false,
      descriptionClipped: false
    });
    expect(opportunity.evaluation).toMatchObject({
      fitBand: "strong",
      recommendation: "review",
      postingConfidence: "high",
      overallConfidence: "high",
      summary: "Strong match.",
      outdated: false,
      createdAt: NOW.toISOString(),
      inputs: {
        opportunityContentHash: upserted.record.contentHash,
        profileRevisionId: "p1",
        resumeRevisionId: "0"
      }
    });
    expect((opportunity.evaluation as { evidence: unknown }).evidence).toEqual([
      { requirement: "TypeScript", evidence: "Shipped TS services", source: "resume" }
    ]);
  });

  it("omits decisionReason when no reason was ever recorded", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input("job-a"), NOW);
    await decideOpportunity(kv, hashOf("job-a"), "passed", undefined, NOW);
    const result = await getOpportunityHandler(portsAt(kv, NOW))({
      identityHash: hashOf("job-a")
    });
    const opportunity = result.opportunity as Record<string, unknown>;
    expect(opportunity.status).toBe("passed");
    expect("decisionReason" in opportunity).toBe(false);
  });

  it("unknown/malformed/missing identityHash → typed error envelopes", async () => {
    const kv = createMemoryKv();
    const handler = wrap(getOpportunityHandler(portsAt(kv, NOW)));
    expect(await handler({ identityHash: "a".repeat(32) })).toMatchObject({
      status: "error",
      code: "missing_record"
    });
    const malformed = await handler({ identityHash: "NOT-A-HASH" });
    expect(malformed).toMatchObject({ status: "error", code: "invalid_record" });
    // Scrubbed: the submitted value never appears in the error.
    expect(String(malformed.message)).not.toContain("NOT-A-HASH");
    expect(await handler({})).toMatchObject({ status: "error", code: "invalid_input" });
  });

  it("no evaluation record ⇒ evaluation key absent", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input("job-a"), NOW);
    const result = await getOpportunityHandler(portsAt(kv, NOW))({
      identityHash: hashOf("job-a")
    });
    expect("evaluation" in (result.opportunity as Record<string, unknown>)).toBe(false);
  });

  it("marks the evaluation outdated when the profile revision moves", async () => {
    const kv = createMemoryKv();
    await approveBoth(kv);
    const upserted = await upsertOpportunity(kv, input("job-a"), NOW);
    if (upserted.suppressed) throw new Error("unexpected tombstone");
    await saveEvaluation(kv, evalFor(hashOf("job-a"), upserted.record.contentHash));
    await saveProfileRevision(kv, {
      schemaVersion: 1,
      revisionId: "p2",
      createdAt: NOW.toISOString(),
      provenance: "user",
      fields: { targetTitles: ["Principal Engineer"] }
    });
    await approveProfile(kv, "p2", NOW);
    const result = await getOpportunityHandler(portsAt(kv, NOW))({
      identityHash: hashOf("job-a")
    });
    expect((result.opportunity as { evaluation: { outdated: boolean } }).evaluation.outdated).toBe(
      true
    );
  });

  it("marks the evaluation outdated when no resume is active", async () => {
    const kv = createMemoryKv();
    // Profile approved, but no resume ever saved — missing pointer ⇒ outdated.
    await saveProfileRevision(kv, {
      schemaVersion: 1,
      revisionId: "p1",
      createdAt: NOW.toISOString(),
      provenance: "user",
      fields: { targetTitles: ["Staff Engineer"] }
    });
    await approveProfile(kv, "p1", NOW);
    const upserted = await upsertOpportunity(kv, input("job-a"), NOW);
    if (upserted.suppressed) throw new Error("unexpected tombstone");
    await saveEvaluation(kv, evalFor(hashOf("job-a"), upserted.record.contentHash));
    const result = await getOpportunityHandler(portsAt(kv, NOW))({
      identityHash: hashOf("job-a")
    });
    expect((result.opportunity as { evaluation: { outdated: boolean } }).evaluation.outdated).toBe(
      true
    );
  });

  it("worst-case detail (16 KB description + maxed evaluation) fits the budget", async () => {
    const kv = createMemoryKv();
    await approveBoth(kv);
    const upserted = await upsertOpportunity(
      kv,
      // Over DESCRIPTION_MAX_BYTES so the STORED flag is exercised too.
      input("job-a", { description: "D".repeat(20_000) }),
      NOW
    );
    if (upserted.suppressed) throw new Error("unexpected tombstone");
    // As large as saveEvaluation allows (~21 KB < EVALUATION_MAX_BYTES) while
    // exceeding every detail cap: 8 items × 300-char fields, 1,200-char summary.
    const big = (n: number) => Array.from({ length: 8 }, () => "X".repeat(n));
    await saveEvaluation(
      kv,
      evalFor(hashOf("job-a"), upserted.record.contentHash, {
        evidence: Array.from({ length: 8 }, () => ({
          requirement: "R".repeat(300),
          evidence: "E".repeat(300),
          source: "S".repeat(300)
        })),
        blockers: big(300),
        gaps: big(300),
        unknowns: big(300),
        preferenceMatches: big(300),
        preferenceConflicts: big(300),
        summary: "S".repeat(1_200)
      })
    );
    const result = await getOpportunityHandler(portsAt(kv, NOW))({
      identityHash: hashOf("job-a")
    });
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(
      RESPONSE_BUDGET_BYTES
    );
    const opportunity = result.opportunity as {
      posting: { description: string; descriptionTruncated: boolean; descriptionClipped: boolean };
      evaluation: {
        summary: string;
        evidence: Array<{ requirement: string; evidence: string; source: string }>;
        gaps: string[];
      };
    };
    expect(opportunity.posting.descriptionTruncated).toBe(true);
    expect(opportunity.posting.descriptionClipped).toBe(true);
    expect(opportunity.evaluation.evidence.length).toBeLessThanOrEqual(DETAIL_EVIDENCE_MAX_ITEMS);
    for (const item of opportunity.evaluation.evidence) {
      expect(Buffer.byteLength(item.requirement, "utf8")).toBeLessThanOrEqual(
        DETAIL_TEXT_MAX_BYTES
      );
      expect(Buffer.byteLength(item.evidence, "utf8")).toBeLessThanOrEqual(DETAIL_TEXT_MAX_BYTES);
      expect(Buffer.byteLength(item.source, "utf8")).toBeLessThanOrEqual(DETAIL_TEXT_MAX_BYTES);
    }
    expect(opportunity.evaluation.gaps.length).toBeLessThanOrEqual(DETAIL_EVIDENCE_MAX_ITEMS);
    for (const gap of opportunity.evaluation.gaps) {
      expect(Buffer.byteLength(gap, "utf8")).toBeLessThanOrEqual(DETAIL_TEXT_MAX_BYTES);
    }
    expect(Buffer.byteLength(opportunity.evaluation.summary, "utf8")).toBeLessThanOrEqual(
      DETAIL_SUMMARY_MAX_BYTES
    );
  });

  it("escape-heavy description cannot blow the budget through JSON escaping", async () => {
    const kv = createMemoryKv();
    // 12,000 raw bytes that DOUBLE under JSON escaping ('"' → '\\"', '\n' →
    // '\\n') — the naive plan rule (allowance measured in raw bytes) would
    // serialize ~24 KB; the escape-aware clip must converge under budget.
    await upsertOpportunity(kv, input("job-a", { description: '"\n'.repeat(6_000) }), NOW);
    const result = await getOpportunityHandler(portsAt(kv, NOW))({
      identityHash: hashOf("job-a")
    });
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(
      RESPONSE_BUDGET_BYTES
    );
    const posting = (result.opportunity as { posting: Record<string, unknown> }).posting;
    expect(posting.descriptionClipped).toBe(true);
    expect((posting.description as string).length).toBeGreaterThan(0);
  });

  it("small record keeps its description intact with descriptionClipped false", async () => {
    const kv = createMemoryKv();
    await upsertOpportunity(kv, input("job-a", { description: "Short and sweet." }), NOW);
    const result = await getOpportunityHandler(portsAt(kv, NOW))({
      identityHash: hashOf("job-a")
    });
    expect((result.opportunity as { posting: Record<string, unknown> }).posting).toMatchObject({
      description: "Short and sweet.",
      descriptionTruncated: false,
      descriptionClipped: false
    });
  });
});

// Task 4 (#937): opportunity.decide — the confirm-gated write. The handler
// only reaches execution through the assistant confirm flow, but its OWN
// discipline still matters: the reason is owner-private content that must
// never echo back through the response or an error message.
describe("opportunity.decide", () => {
  it("persists a saved decision with reason and rebuilds the feed", async () => {
    const kv = createMemoryKv();
    const ports = portsAt(kv, NOW);
    await upsertOpportunity(kv, input("dec-1", { title: "Staff Engineer" }), NOW);
    const identityHash = hashOf("dec-1");

    const response = await decideOpportunityHandler(ports)({
      identityHash,
      decision: "saved",
      reason: "Comp fits the target band"
    });

    expect(response).toEqual({
      status: "ok",
      identityHash,
      decision: "saved",
      statusAt: NOW.toISOString()
    });
    const record = await getOpportunity(kv, identityHash);
    expect(record?.status).toBe("saved");
    expect(record?.decisionReason).toBe("Comp fits the target band");
    // Feed index rebuilt in the same call — readers see the new status
    // without waiting for a monitor run.
    const feed = await readFeed(kv);
    const entry = feed?.entries.find((candidate) => candidate.h === identityHash);
    expect(entry?.s).toBe("saved");
  });

  it("never echoes the reason in the response", async () => {
    const kv = createMemoryKv();
    const ports = portsAt(kv, NOW);
    await upsertOpportunity(kv, input("dec-2", { title: "Staff Engineer" }), NOW);

    const secret = "private-rationale-marker-9f2c";
    const response = await decideOpportunityHandler(ports)({
      identityHash: hashOf("dec-2"),
      decision: "passed",
      reason: secret
    });

    expect(JSON.stringify(response)).not.toContain(secret);
  });

  it("rejects an oversized reason naming key and cap only, without writing", async () => {
    const kv = createMemoryKv();
    const ports = portsAt(kv, NOW);
    await upsertOpportunity(kv, input("dec-3", { title: "Staff Engineer" }), NOW);

    const oversized = "z".repeat(DECISION_REASON_MAX_BYTES + 1);
    const result = await wrap(decideOpportunityHandler(ports))({
      identityHash: hashOf("dec-3"),
      decision: "saved",
      reason: oversized
    });

    expect(result.status).toBe("error");
    expect(result.code).toBe("invalid_input");
    expect(result.message).toContain("reason");
    expect(result.message).toContain(String(DECISION_REASON_MAX_BYTES));
    // The submitted text never appears in the error surface.
    expect(result.message).not.toContain(oversized);
    // Validation failed BEFORE any write — the decision must not half-apply.
    const record = await getOpportunity(kv, hashOf("dec-3"));
    expect(record?.status).toBe("new");
    expect(record?.decisionReason).toBeUndefined();
  });

  it("returns missing_record for an unknown hash", async () => {
    const kv = createMemoryKv();
    const ports = portsAt(kv, NOW);

    const result = await wrap(decideOpportunityHandler(ports))({
      identityHash: "0123456789abcdef0123456789abcdef",
      decision: "saved"
    });

    expect(result.status).toBe("error");
    expect(result.code).toBe("missing_record");
  });

  it("rejects an unknown decision value listing the allowed values", async () => {
    const kv = createMemoryKv();
    const ports = portsAt(kv, NOW);
    await upsertOpportunity(kv, input("dec-4", { title: "Staff Engineer" }), NOW);

    const result = await wrap(decideOpportunityHandler(ports))({
      identityHash: hashOf("dec-4"),
      decision: "archived"
    });

    expect(result.status).toBe("error");
    expect(result.code).toBe("invalid_input");
    expect(result.message).toContain("saved");
    expect(result.message).toContain("passed");
  });
});
