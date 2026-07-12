// tests/unit/external-module-job-search-kv-feed.test.ts
//
// JS-02 (#931) Task 8: feed index. The feed is DERIVED state — rebuilt from
// job/* canonical records, never a source of truth — so a corrupt index is
// detected (corrupt_index), recoverable (readFeedOrRebuild), and an
// interrupted upsert+rebuild flow converges on retry without losing a
// posting.
//
// JS-07 (#936) Step 6: the rebuild additionally stamps additive-optional
// single-char code fields (e gate verdict, b fit band, c confidence — see
// the byte budget in feed.ts) and sorts by the spec order: eligibility →
// fit band (strong > possible > low > pending) → confidence → freshness →
// newest posting first, identity hash as the final deterministic
// tie-break. Freshness and posted-at feed the sort but are never stored.
// Pending survivors (no evaluation, or an outdated one) sort below
// completed evaluations but never disappear, and an OLD stored index whose
// entries carry only {h, r, s} still reads cleanly (additive ABI).
import { describe, expect, it } from "vitest";

import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import type {
  EvaluationConfidence,
  EvaluationRecord,
  FitBand
} from "../../external-modules/job-search/src/domain/evaluations.js";
import { saveEvaluation } from "../../external-modules/job-search/src/domain/evaluations.js";
import {
  FEED_BAND_CODES,
  FEED_CONFIDENCE_CODES,
  FEED_GATE_CODES,
  readFeed,
  readFeedOrRebuild,
  rebuildFeed
} from "../../external-modules/job-search/src/domain/feed.js";
import { markFreshnessAfterRun } from "../../external-modules/job-search/src/domain/freshness.js";
import type {
  OpportunityInput,
  OpportunityRecord
} from "../../external-modules/job-search/src/domain/opportunities.js";
import { upsertOpportunity } from "../../external-modules/job-search/src/domain/opportunities.js";
import {
  evaluationIdentity,
  keys,
  opportunityIdentity,
  sourceKey
} from "../../external-modules/job-search/src/domain/keys.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import {
  approveProfile,
  saveProfileRevision
} from "../../external-modules/job-search/src/domain/profile.js";
import {
  approveResume,
  saveOriginalResume
} from "../../external-modules/job-search/src/domain/resume.js";
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
      // {h, r, s} and NOTHING else — no titles/companies in the index, and
      // the JS-07 codes (e/b/c) stay absent without a profile/evaluations.
      // Freshness and postedAt are sort inputs only, never stored (the
      // whole index is one kv value under KV_VALUE_MAX_BYTES).
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

// ---------------------------------------------------------------------------
// JS-07 (#936) Step 6: spec ordering + evaluation-aware entry fields.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-11T12:00:00.000Z");
const SEED_AT = new Date("2026-07-05T09:00:00.000Z");
const SRC = sourceKey("greenhouse", "acme");
const PROFILE_REV = "profile-rev-1";
const RESUME_REV = "0";

async function seedProfile(kv: MemoryKv, fields: Record<string, unknown>): Promise<void> {
  await saveProfileRevision(kv, {
    schemaVersion: 1,
    revisionId: PROFILE_REV,
    createdAt: NOW.toISOString(),
    provenance: "user",
    fields
  });
  await approveProfile(kv, PROFILE_REV, NOW);
}

async function seedResume(kv: MemoryKv): Promise<void> {
  await saveOriginalResume(kv, "Resume: 8 years TypeScript at Acme.", NOW);
  await approveResume(kv, RESUME_REV, NOW);
}

async function seedJob(
  kv: MemoryKv,
  externalId: string,
  opts: {
    at?: Date;
    sourceKey?: string;
    posting?: Partial<OpportunityInput["posting"]>;
  } = {}
): Promise<OpportunityRecord> {
  const result = await upsertOpportunity(
    kv,
    {
      adapterId: "greenhouse",
      externalId,
      ...(opts.sourceKey !== undefined ? { sourceKey: opts.sourceKey } : {}),
      posting: {
        title: `Job ${externalId}`,
        company: "Acme",
        description: `Description for job ${externalId}.`,
        ...opts.posting
      }
    },
    opts.at ?? SEED_AT
  );
  if (result.suppressed) {
    throw new Error("unexpected tombstone suppression in fixture");
  }
  return result.record;
}

/** A stored evaluation; inputs override lets tests plant OUTDATED records. */
function makeEval(
  record: OpportunityRecord,
  fitBand: FitBand,
  confidence: EvaluationConfidence,
  inputsOverride: Partial<EvaluationRecord["inputs"]> = {}
): EvaluationRecord {
  const inputs = {
    opportunityContentHash: record.contentHash,
    profileRevisionId: PROFILE_REV,
    resumeRevisionId: RESUME_REV,
    ...inputsOverride
  };
  return {
    schemaVersion: 1,
    evaluationId: evaluationIdentity(inputs),
    identityHash: record.identityHash,
    fitBand,
    recommendation: "review",
    evidence: [],
    blockers: [],
    gaps: [],
    unknowns: [],
    preferenceMatches: [],
    preferenceConflicts: [],
    postingConfidence: confidence,
    overallConfidence: confidence,
    summary: "Fixture evaluation.",
    inputs,
    createdAt: NOW.toISOString()
  };
}

describe("feed ordering + evaluation fields (JS-07)", () => {
  it("sorts eligibility → fit band → confidence → freshness → newest → hash", async () => {
    const kv = createMemoryKv();
    await seedProfile(kv, { excludedCompanies: ["badco"], dealbreakers: ["on-call"] });
    await seedResume(kv);

    // Eligible, evaluated — distinct band/confidence/freshness ranks.
    const strongHigh = await seedJob(kv, "strong-high");
    const strongMed = await seedJob(kv, "strong-med");
    const strongMedUnc = await seedJob(kv, "strong-med-unc"); // stays uncertain
    const possibleHigh = await seedJob(kv, "possible-high");
    const lowHigh = await seedJob(kv, "low-high");
    // Pending group (equal ranks): ordered by p = publishedAt DESC.
    const pendingNew = await seedJob(kv, "pending-new", {
      posting: { publishedAt: "2026-07-10T00:00:00.000Z" }
    });
    const pendingOutdated = await seedJob(kv, "pending-outdated", {
      posting: { publishedAt: "2026-07-09T00:00:00.000Z" }
    });
    const pendingOld = await seedJob(kv, "pending-old", {
      posting: { publishedAt: "2026-07-08T00:00:00.000Z" }
    });
    // Equal p → identity hash ascending decides.
    const tie1 = await seedJob(kv, "tie-1", {
      posting: { publishedAt: "2026-07-07T00:00:00.000Z" }
    });
    const tie2 = await seedJob(kv, "tie-2", {
      posting: { publishedAt: "2026-07-07T00:00:00.000Z" }
    });
    // Flagged beats nothing eligible, even with a strong evaluation.
    const flaggedStrong = await seedJob(kv, "flagged-strong", {
      posting: { description: "Weekly on-call rotation required." }
    });
    // Excluded stays present, sorted last (company block / stale posting).
    const excludedCo = await seedJob(kv, "excluded-co", { posting: { company: "BadCo" } });
    const staleJob = await seedJob(kv, "stale-job", { sourceKey: SRC });

    // Freshness pass: everything seen → active; stale-job bound to SRC but
    // unseen → stale; strong-med-unc + excluded-co untouched → uncertain.
    await markFreshnessAfterRun(kv, {
      sourceKey: SRC,
      seenIdentityHashes: new Set(
        [
          strongHigh,
          strongMed,
          possibleHigh,
          lowHigh,
          pendingNew,
          pendingOutdated,
          pendingOld,
          tie1,
          tie2,
          flaggedStrong
        ].map((r) => r.identityHash)
      ),
      now: NOW
    });

    await saveEvaluation(kv, makeEval(strongHigh, "strong", "high"));
    await saveEvaluation(kv, makeEval(strongMed, "strong", "medium"));
    await saveEvaluation(kv, makeEval(strongMedUnc, "strong", "medium"));
    await saveEvaluation(kv, makeEval(possibleHigh, "possible", "high"));
    await saveEvaluation(kv, makeEval(lowHigh, "low", "high"));
    await saveEvaluation(kv, makeEval(flaggedStrong, "strong", "high"));
    // Outdated (stale profile revision) → treated as pending, band ignored.
    await saveEvaluation(
      kv,
      makeEval(pendingOutdated, "strong", "high", { profileRevisionId: "stale-profile-rev" })
    );

    const feed = await rebuildFeed(kv, NOW);
    const [tieA, tieB] = tie1.identityHash < tie2.identityHash ? [tie1, tie2] : [tie2, tie1];
    expect(feed.entries.map((e) => e.h)).toEqual(
      [
        strongHigh, // eligible strong high active
        strongMed, // … medium confidence after high
        strongMedUnc, // … uncertain freshness after active
        possibleHigh, // possible after strong
        lowHigh, // low after possible
        pendingNew, // pending group: newest publishedAt first
        pendingOutdated, // outdated evaluation counts as pending
        pendingOld,
        tieA, // equal p → hash ascending
        tieB,
        flaggedStrong, // flagged after ALL eligible, even strong
        excludedCo, // excluded present but last (uncertain before stale)
        staleJob
      ].map((r) => r.identityHash)
    );

    const byHash = new Map(feed.entries.map((e) => [e.h, e]));
    const top = byHash.get(strongHigh.identityHash);
    expect(top?.e).toBe(FEED_GATE_CODES.eligible);
    expect(top?.b).toBe(FEED_BAND_CODES.strong);
    expect(top?.c).toBe(FEED_CONFIDENCE_CODES.high);

    const pending = byHash.get(pendingOutdated.identityHash);
    expect(pending?.e).toBe(FEED_GATE_CODES.eligible);
    expect(pending?.b).toBeUndefined(); // outdated → pending, band absent
    expect(pending?.c).toBeUndefined();

    expect(byHash.get(flaggedStrong.identityHash)?.e).toBe(FEED_GATE_CODES.flagged);
    expect(byHash.get(excludedCo.identityHash)?.e).toBe(FEED_GATE_CODES.excluded);
    // Stale posting is gate-excluded; freshness itself is not stored.
    expect(byHash.get(staleJob.identityHash)?.e).toBe(FEED_GATE_CODES.excluded);
  });

  it("keeps a fully-evaluated 510-entry index under the kv value byte cap", async () => {
    // Retention protects saved records past the 500 target, so 510 fully
    // evaluated eligible entries is a DESIGNED state — the rebuild must
    // stay under KV_VALUE_MAX_BYTES with every JS-07 field stamped
    // (regression: full-string verdict/band/confidence values overflowed).
    const kv = createMemoryKv();
    await seedProfile(kv, {});
    await seedResume(kv);
    const records: OpportunityRecord[] = [];
    for (let i = 0; i < 510; i += 1) {
      records.push(
        await seedJob(kv, `bulk-${i}`, {
          at: new Date(SEED_AT.getTime() + i * 60_000),
          posting: { publishedAt: new Date(SEED_AT.getTime() + i * 1_000).toISOString() }
        })
      );
    }
    for (const record of records) {
      await saveEvaluation(kv, makeEval(record, "strong", "high"));
    }

    const feed = await rebuildFeed(kv, NOW); // throws oversize_value on regression
    expect(feed.entries).toHaveLength(510);
    expect(feed.entries.every((e) => e.e !== undefined && e.b !== undefined)).toBe(true);
  });

  it("stamps no gate verdict and keeps bands pending without an approved profile", async () => {
    const kv = createMemoryKv();
    await seedResume(kv);
    const job = await seedJob(kv, "no-profile");
    // A stored evaluation exists, but without a profile its currency can't
    // be established — the feed must not surface a possibly-stale band.
    await saveEvaluation(kv, makeEval(job, "strong", "high"));

    const feed = await rebuildFeed(kv, NOW);
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]?.e).toBeUndefined();
    expect(feed.entries[0]?.b).toBeUndefined();
    expect(feed.entries[0]?.c).toBeUndefined();
  });

  it("stamps the gate verdict but keeps bands pending without an approved resume", async () => {
    const kv = createMemoryKv();
    await seedProfile(kv, {});
    const job = await seedJob(kv, "no-resume");
    await saveEvaluation(kv, makeEval(job, "strong", "high"));

    const feed = await rebuildFeed(kv, NOW);
    expect(feed.entries[0]?.e).toBe(FEED_GATE_CODES.eligible);
    expect(feed.entries[0]?.b).toBeUndefined();
    expect(feed.entries[0]?.c).toBeUndefined();
  });

  it("still reads an OLD stored index whose entries carry only {h, r, s}", async () => {
    const kv = createMemoryKv();
    const oldIndex = {
      schemaVersion: 1,
      rebuiltAt: "2026-07-01T00:00:00.000Z",
      entries: [{ h: hashOf("j1"), r: "2026-07-01T00:00:00.000Z", s: "new" }]
    };
    await kv.set(NS.feed, keys.feedActive, oldIndex);

    const feed = await readFeed(kv);
    expect(feed?.entries).toHaveLength(1);
    expect(feed?.entries[0]?.h).toBe(hashOf("j1"));
  });
});
