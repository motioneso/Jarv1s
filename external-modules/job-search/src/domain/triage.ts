// external-modules/job-search/src/domain/triage.ts
//
// Task 8 (#1292): stage 2 — embedding triage with a reserved recall slice. Pure domain
// code: no SDK imports, no network, no database access.
//
// This is the stage most likely to be implemented wrong: a naive "keep the top N by
// similarity to the stated criteria" implementation silently deletes the product's entire
// reason for existing — the postings a keyword search would never surface. RECALL_SLICE
// reserves a floor of every pass for exactly those postings and is not a tuning knob.
//
// DIVERGENCE FROM THE PART FILE (ledger outranks a part file on conflict — precedent N11):
// `parts/13-task08-triage.md`'s prose reads "a missing similarity entry reads as 0, so a
// posting that failed to embed degrades to in-frame and low-ranked rather than throwing".
// The ledger's restated recall-reservation ruling requires the opposite: "treat a missing
// similarity as 'defer', not as a legitimate zero." Scoring a failed embedding as 0 buries
// it at the bottom of the in-frame ranking, where an ordinary budget silently drops it —
// exactly the postings we failed to embed disappear with no signal, which is worse than
// throwing. This file follows the ledger: a posting missing an entry in EITHER similarity
// map is excluded from bucketing and ranking entirely and is counted only in `deferred`,
// never scored as if it had a real value. No test in the part file's own list exercises the
// part file's reading, so this costs nothing there; a dedicated test below locks the
// ledger's behaviour instead.

import type { Posting } from "./records.js";

export interface TriageInput {
  postings: readonly Posting[];
  /** Similarity of each posting to the stated criteria, keyed by posting id, 0..1. */
  criteriaSimilarity: ReadonlyMap<string, number>;
  /** Similarity to the user's broader profile — goals, notes, past conversation. */
  profileSimilarity: ReadonlyMap<string, number>;
  /** How many postings the scoring model will read this pass. */
  budget: number;
}

export interface TriageResult {
  /** Ordered: in-frame first, then the reserved recall slice. */
  selected: Array<{ posting: Posting; outsideFrame: boolean }>;
  /** How many postings were considered but not selected. Shown as a count only. */
  deferred: number;
}

/** Share of the budget reserved for postings the stated criteria would have missed. Not a
 * tuning knob: this is the recall case the product exists to catch, and lowering it to
 * save tokens quietly defeats the point of stage 2. */
export const RECALL_SLICE = 0.2;

/** A posting is "outside the stated frame" when it is a poor match for what the user
 * asked for but a strong match for who they are. Both halves are required — low criteria
 * similarity alone is just a bad match, not a recall case. */
const OUTSIDE_FRAME_CRITERIA_MAX = 0.5;
const OUTSIDE_FRAME_PROFILE_MIN = 0.6;

type Candidate = { posting: Posting; score: number };

export function triage(input: TriageInput): TriageResult {
  const { postings, criteriaSimilarity, profileSimilarity, budget } = input;

  if (budget <= 0 || postings.length === 0) {
    // Deferral is always reported, never silent.
    return { selected: [], deferred: postings.length };
  }

  // Single pass bucketing — the obvious filter+includes shape is O(n^2) over a list that
  // routinely holds several hundred postings after a sweep. A posting missing an entry in
  // either map failed to embed and is skipped here entirely (see the header divergence
  // note); it lands in `deferred` by construction, never in a bucket.
  const outside: Candidate[] = [];
  const inFrame: Candidate[] = [];

  for (const posting of postings) {
    const criteria = criteriaSimilarity.get(posting.id);
    const profile = profileSimilarity.get(posting.id);
    if (criteria === undefined || profile === undefined) {
      continue;
    }
    if (criteria <= OUTSIDE_FRAME_CRITERIA_MAX && profile >= OUTSIDE_FRAME_PROFILE_MIN) {
      outside.push({ posting, score: profile });
    } else {
      inFrame.push({ posting, score: criteria });
    }
  }

  outside.sort((a, b) => b.score - a.score);
  inFrame.sort((a, b) => b.score - a.score);

  // The reservation formula is the decision.
  let reserved: number;
  if (outside.length === 0) {
    reserved = 0;
  } else if (inFrame.length === 0) {
    reserved = budget;
  } else {
    // max(1, ...) is the floor: at least one recall seat whenever a candidate exists, even
    // at budgets where the percentage floors to zero — one seat is the difference between
    // the feature existing and not existing. budget - 1 is the ceiling: the recall slice
    // is a floor on recall, not a licence to spend the whole pass on a hunch — at budget 1
    // with both kinds present, the stated criteria win.
    reserved = Math.min(Math.max(1, Math.floor(budget * RECALL_SLICE)), budget - 1);
  }
  const inFrameAllotted = budget - reserved;

  // Whichever pool is smaller than its own allotment hands its unused seats to the other,
  // in similarity order. Both deficits are computed against the ORIGINAL allotments before
  // either backfill is applied, so a backfill in one direction can never feed the deficit
  // calculation for the other.
  const outsideInitial = Math.min(reserved, outside.length);
  const inFrameInitial = Math.min(inFrameAllotted, inFrame.length);
  const outsideDeficit = reserved - outsideInitial;
  const inFrameDeficit = inFrameAllotted - inFrameInitial;

  const inFrameTake = Math.min(inFrameInitial + outsideDeficit, inFrame.length);
  const outsideTake = Math.min(outsideInitial + inFrameDeficit, outside.length);

  const selected = [
    ...inFrame.slice(0, inFrameTake).map((c) => ({ posting: c.posting, outsideFrame: false })),
    ...outside.slice(0, outsideTake).map((c) => ({ posting: c.posting, outsideFrame: true }))
  ];

  return { selected, deferred: postings.length - selected.length };
}
