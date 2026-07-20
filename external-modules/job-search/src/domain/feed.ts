// external-modules/job-search/src/domain/feed.ts
//
// JS-02 (#931): feed index. Purely DERIVED state rebuilt from job/*
// canonical records — a lost or corrupt index never loses a posting.
// readFeed returns null on any stored-shape drift;
// readFeedOrRebuild catches exactly that (and absence) and repairs.
// Entries are compact — no titles, companies, or URLs, so the index
// leaks nothing beyond what job/* and eval/* already hold.
//
// JS-07 (#936) Step 6: rebuilds sort by the spec order (eligibility → fit
// band → confidence → freshness → newest posting first, identity hash as
// the final tie-break) and stamp additive-optional entry fields. Old
// readers keep working: isFeedEntry still validates only {h, r, s}, and a
// pre-JS-07 stored index reads cleanly (Key ABI: additive only —
// records.ts hard-pins schemaVersion 1 on read AND write).
//
// BYTE BUDGET (plan hard-constraint 4 overrides the plan's field list):
// the whole index is ONE kv value capped at KV_VALUE_MAX_BYTES (65,535),
// and retention protects saved records past the 500 target, so a 510+
// entry rebuild is a designed state, not a corner. Full-string verdict/
// band/confidence values would put worst-case entries at ~136 bytes
// (≈69 KB at 510 — over the cap), so the JS-07 fields are single-char
// codes (~117 bytes worst case, ≈60 KB at 510). Freshness and postedAt
// are NOT stored at all: they are derivable from the job record every
// reader must fetch anyway (the index carries nothing renderable), so
// they only feed the sort, computed here at rebuild time. e/b/c ARE
// stored because deriving them needs profile + evaluation reads.
import { JobSearchKvError } from "./errors.js";
import type { EvaluationConfidence, EvaluationInputs, FitBand } from "./evaluations.js";
import { getEvaluation, isOutdated } from "./evaluations.js";
import type { Freshness } from "./freshness.js";
import { freshnessOf } from "./freshness.js";
import type { GateVerdict } from "./gate.js";
import { applyGate } from "./gate.js";
import { keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import type { OpportunityStatus } from "./opportunities.js";
import { listOpportunities } from "./opportunities.js";
import { getActiveProfile } from "./profile.js";
import { readRecord, writeRecord } from "./records.js";
import { getActiveResume } from "./resume.js";

// Single-char storage codes (see byte budget above). Exported so feed
// readers (JS-08 web) decode without duplicating the mapping.
export const FEED_GATE_CODES = { eligible: "e", flagged: "f", excluded: "x" } as const;
export const FEED_BAND_CODES = { strong: "s", possible: "p", low: "l" } as const;
export const FEED_CONFIDENCE_CODES = { high: "h", medium: "m", low: "l" } as const;
export type FeedGateCode = (typeof FEED_GATE_CODES)[GateVerdict];
export type FeedBandCode = (typeof FEED_BAND_CODES)[FitBand];
export type FeedConfidenceCode = (typeof FEED_CONFIDENCE_CODES)[EvaluationConfidence];

export interface FeedEntry {
  h: string; // identityHash
  r: string; // rank key = lastSeenAt (ISO-8601 sorts lexicographically)
  s: OpportunityStatus;
  // JS-07 additive-optional fields. All ABSENT on pre-JS-07 indexes; old
  // readers ignore them (isFeedEntry checks only h/r/s).
  e?: FeedGateCode; // gate verdict; absent when no approved profile exists
  b?: FeedBandCode; // absent = evaluation pending (missing OR outdated)
  c?: FeedConfidenceCode; // overall confidence; absent = pending
}

export interface FeedIndex {
  schemaVersion: 1;
  rebuiltAt: string;
  entries: readonly FeedEntry[];
}

function isFeedEntry(value: unknown): value is FeedEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FeedEntry).h === "string" &&
    typeof (value as FeedEntry).r === "string" &&
    typeof (value as FeedEntry).s === "string"
  );
}

// Spec sort (JS-07): each dimension collapses to a small ascending rank so
// the comparator is one tuple walk. Absence ranks are deliberate:
//  - e absent (no approved profile) sits between flagged and excluded —
//    ungated entries must not outrank explicitly-eligible ones, but an
//    explicit exclusion is still the stronger negative signal.
//  - b/c absent = evaluation pending → below every completed band, per the
//    spec ("pending survivors sort below completed but stay present").
const E_RANK: Record<FeedGateCode, number> = { e: 0, f: 1, x: 3 };
const E_ABSENT = 2;
const B_RANK: Record<FeedBandCode, number> = { s: 0, p: 1, l: 2 };
const B_ABSENT = 3;
const C_RANK: Record<FeedConfidenceCode, number> = { h: 0, m: 1, l: 2 };
const C_ABSENT = 3;
const F_RANK: Record<Freshness, number> = { active: 0, uncertain: 1, stale: 2 };

// Sort-only decoration: freshness rank and the posted-at anchor are read
// off the full job records in hand during rebuild and deliberately NOT
// persisted (byte budget above).
interface RankedEntry {
  entry: FeedEntry;
  fRank: number;
  p: string; // posting.publishedAt ?? firstSeenAt
}

function compareRanked(a: RankedEntry, b: RankedEntry): number {
  const ranks = (x: RankedEntry): readonly number[] => [
    x.entry.e !== undefined ? E_RANK[x.entry.e] : E_ABSENT,
    x.entry.b !== undefined ? B_RANK[x.entry.b] : B_ABSENT,
    x.entry.c !== undefined ? C_RANK[x.entry.c] : C_ABSENT,
    x.fRank
  ];
  const ra = ranks(a);
  const rb = ranks(b);
  for (let i = 0; i < ra.length; i += 1) {
    if (ra[i] !== rb[i]) {
      return ra[i]! - rb[i]!;
    }
  }
  if (a.p !== b.p) {
    return a.p < b.p ? 1 : -1; // newest posting first
  }
  return a.entry.h < b.entry.h ? -1 : 1; // deterministic content-free tie-break
}

// Pure compute — no kv.set. Shared by rebuildFeed (persists, for write-risk
// callers) and readFeedOrRebuild (#1203: a read-risk handler must never
// trigger the RPC host's forbidden_kv_mutation, so the read path computes
// and returns without writing).
async function buildFeedIndex(kv: JobSearchKv, now: Date): Promise<FeedIndex> {
  const jobs = await listOpportunities(kv);
  // Gate needs an approved profile; band currency (isOutdated) additionally
  // needs the approved resume — half an identity can't prove an evaluation
  // current, so without either the entry stays pending rather than surface
  // a possibly-stale band.
  const profile = await getActiveProfile(kv);
  const resume = await getActiveResume(kv);
  const ranked: RankedEntry[] = [];
  for (const job of jobs) {
    const entry: FeedEntry = { h: job.identityHash, r: job.lastSeenAt, s: job.status };
    if (profile !== null) {
      entry.e = FEED_GATE_CODES[applyGate(profile.fields, job).verdict];
      if (resume !== null) {
        const current: EvaluationInputs = {
          opportunityContentHash: job.contentHash,
          profileRevisionId: profile.revisionId,
          resumeRevisionId: resume.revisionId
        };
        const evaluation = await getEvaluation(kv, job.identityHash);
        if (evaluation !== null && !isOutdated(evaluation, current)) {
          entry.b = FEED_BAND_CODES[evaluation.fitBand];
          entry.c = FEED_CONFIDENCE_CODES[evaluation.overallConfidence];
        }
      }
    }
    ranked.push({
      entry,
      fRank: F_RANK[freshnessOf(job)],
      p: job.posting.publishedAt ?? job.firstSeenAt
    });
  }
  ranked.sort(compareRanked);
  return {
    schemaVersion: 1,
    rebuiltAt: now.toISOString(),
    entries: ranked.map((r) => r.entry)
  };
}

export async function rebuildFeed(kv: JobSearchKv, now: Date): Promise<FeedIndex> {
  const index = await buildFeedIndex(kv, now);
  await writeRecord(kv, NS.feed, keys.feedActive, index);
  return index;
}

export async function readFeed(kv: JobSearchKv): Promise<FeedIndex | null> {
  let stored: Record<string, unknown> | null;
  try {
    stored = await readRecord(kv, NS.feed, keys.feedActive);
  } catch (error) {
    // A corrupt DERIVED key is equivalent to a missing index.
    if (error instanceof JobSearchKvError) {
      return null;
    }
    throw error;
  }
  if (stored === null) {
    return null;
  }
  if (
    typeof stored.rebuiltAt !== "string" ||
    !Array.isArray(stored.entries) ||
    !stored.entries.every(isFeedEntry)
  ) {
    return null;
  }
  return stored as unknown as FeedIndex;
}

export async function readFeedOrRebuild(kv: JobSearchKv, now: Date): Promise<FeedIndex> {
  const feed = await readFeed(kv);
  return feed ?? buildFeedIndex(kv, now);
}
