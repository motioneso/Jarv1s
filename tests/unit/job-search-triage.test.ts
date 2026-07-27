// tests/unit/job-search-triage.test.ts
//
// Task 8 (#1292): stage-2 embedding triage with a reserved recall slice.
//
// Test 9 below is not in the task's part file. It locks the ledger's ruling over the part
// file's prose (see the divergence note at the top of ../../external-modules/job-search/
// src/domain/triage.ts): a posting missing a similarity entry must be deferred, never
// scored as 0. No spec-pinned test exercises this, so it costs nothing to get right here.

import { describe, expect, it } from "vitest";
import {
  RECALL_SLICE,
  triage,
  type TriageInput
} from "../../external-modules/job-search/src/domain/triage.js";
import type { Posting } from "../../external-modules/job-search/src/domain/records.js";

function posting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: "posting-1",
    sourceId: "linkedin",
    externalId: "ext-1",
    title: "Software Engineer",
    company: "Acme Corp",
    location: "Seattle, WA",
    url: "https://example.com/jobs/1",
    body: "",
    postedAt: null,
    ...overrides
  };
}

// Builds `count` postings with sequential ids "prefix0".."prefixN-1", plus similarity
// entries in the two maps passed in by the caller.
function postings(prefix: string, count: number): Posting[] {
  return Array.from({ length: count }, (_, i) => posting({ id: `${prefix}${i}` }));
}

describe("triage", () => {
  it("reserves a recall slice: 8 in-frame + 2 out-of-frame, budget 5 -> 5 selected, exactly one out-of-frame", () => {
    expect(RECALL_SLICE).toBe(0.2);

    const inFramePostings = postings("in", 8);
    const outsidePostings = postings("out", 2);

    const criteriaSimilarity = new Map<string, number>();
    const profileSimilarity = new Map<string, number>();
    for (const p of inFramePostings) {
      criteriaSimilarity.set(p.id, 0.9);
      profileSimilarity.set(p.id, 0.4);
    }
    // Distinct profile scores so the winner among the out-of-frame pool is unambiguous
    // rather than resting on sort-stability assumptions.
    criteriaSimilarity.set("out0", 0.2);
    profileSimilarity.set("out0", 0.95);
    criteriaSimilarity.set("out1", 0.2);
    profileSimilarity.set("out1", 0.9);

    const input: TriageInput = {
      postings: [...inFramePostings, ...outsidePostings],
      criteriaSimilarity,
      profileSimilarity,
      budget: 5
    };

    const result = triage(input);
    expect(result.selected).toHaveLength(5);
    const outsideSelected = result.selected.filter((s) => s.outsideFrame).map((s) => s.posting.id);
    expect(outsideSelected).toEqual(["out0"]);
  });

  it("floors to at least one recall seat even when the percentage floors to zero (budget 2)", () => {
    const inFramePostings = postings("in", 2);
    const outsidePostings = postings("out", 1);

    const criteriaSimilarity = new Map<string, number>();
    const profileSimilarity = new Map<string, number>();
    for (const p of inFramePostings) {
      criteriaSimilarity.set(p.id, 0.8);
      profileSimilarity.set(p.id, 0.3);
    }
    criteriaSimilarity.set("out0", 0.1);
    profileSimilarity.set("out0", 0.9);

    const result = triage({
      postings: [...inFramePostings, ...outsidePostings],
      criteriaSimilarity,
      profileSimilarity,
      budget: 2
    });

    expect(result.selected).toHaveLength(2);
    const outsideSelected = result.selected.filter((s) => s.outsideFrame);
    expect(outsideSelected).toHaveLength(1);
    expect(outsideSelected[0]?.posting.id).toBe("out0");
  });

  it("backfills a dry in-frame pool from the outside pool: 1 in-frame + 5 out-of-frame, budget 5", () => {
    const inFramePostings = postings("in", 1);
    const outsidePostings = postings("out", 5);

    const criteriaSimilarity = new Map<string, number>();
    const profileSimilarity = new Map<string, number>();
    criteriaSimilarity.set("in0", 0.9);
    profileSimilarity.set("in0", 0.3);
    outsidePostings.forEach((p, i) => {
      criteriaSimilarity.set(p.id, 0.1);
      profileSimilarity.set(p.id, 0.9 - i * 0.01);
    });

    const result = triage({
      postings: [...inFramePostings, ...outsidePostings],
      criteriaSimilarity,
      profileSimilarity,
      budget: 5
    });

    expect(result.selected).toHaveLength(5);
    expect(result.selected.filter((s) => s.outsideFrame)).toHaveLength(4);
    expect(result.deferred).toBe(1);
  });

  it("at budget 1 with both kinds present, the stated criteria win the only seat", () => {
    const result = triage({
      postings: [posting({ id: "in0" }), posting({ id: "out0" })],
      criteriaSimilarity: new Map([
        ["in0", 0.9],
        ["out0", 0.1]
      ]),
      profileSimilarity: new Map([
        ["in0", 0.3],
        ["out0", 0.9]
      ]),
      budget: 1
    });

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.posting.id).toBe("in0");
    expect(result.selected[0]?.outsideFrame).toBe(false);
  });

  it("never reserves a seat no candidate can fill: no in-frame candidates, budget 1", () => {
    const outsidePostings = postings("out", 2);
    const result = triage({
      postings: outsidePostings,
      criteriaSimilarity: new Map(outsidePostings.map((p) => [p.id, 0.1])),
      profileSimilarity: new Map(outsidePostings.map((p) => [p.id, 0.9])),
      budget: 1
    });

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.outsideFrame).toBe(true);
  });

  it("reserves nothing when there are no out-of-frame candidates: 4 in-frame, budget 3", () => {
    const inFramePostings = postings("in", 4);
    const result = triage({
      postings: inFramePostings,
      criteriaSimilarity: new Map(inFramePostings.map((p) => [p.id, 0.8])),
      profileSimilarity: new Map(inFramePostings.map((p) => [p.id, 0.3])),
      budget: 3
    });

    expect(result.selected).toHaveLength(3);
    expect(result.selected.every((s) => !s.outsideFrame)).toBe(true);
  });

  it("reports deferrals as a count: 10 postings, budget 4 -> 6 deferred", () => {
    const inFramePostings = postings("in", 10);
    const result = triage({
      postings: inFramePostings,
      criteriaSimilarity: new Map(inFramePostings.map((p, i) => [p.id, 0.9 - i * 0.01])),
      profileSimilarity: new Map(inFramePostings.map((p) => [p.id, 0.3])),
      budget: 4
    });

    expect(result.selected).toHaveLength(4);
    expect(result.deferred).toBe(6);
  });

  it("never leaks a similarity value into the result", () => {
    const p = posting({ id: "in0" });
    const result = triage({
      postings: [p],
      criteriaSimilarity: new Map([["in0", 0.77]]),
      profileSimilarity: new Map([["in0", 0.3]]),
      budget: 1
    });

    expect(JSON.stringify(result)).not.toContain("0.77");
  });

  it("defers a posting missing a similarity entry instead of scoring it as 0 (ledger over part file)", () => {
    // "known" is unambiguously in-frame and would win a seat on merit. "unembedded" has no
    // entry in either map at all -- the realistic shape of an embedding failure. If it were
    // scored as 0 (the part file's now-superseded reading), it would still land in-frame
    // (0 <= 0.5 but 0 is NOT >= 0.6, so it fails the outside-frame test) and, with budget
    // covering every posting, would be silently selected as a low-ranked in-frame result.
    // The ledger requires it to be excluded and counted only in `deferred`.
    const known = posting({ id: "known" });
    const unembedded = posting({ id: "unembedded" });

    const result = triage({
      postings: [known, unembedded],
      criteriaSimilarity: new Map([["known", 0.9]]),
      profileSimilarity: new Map([["known", 0.3]]),
      budget: 2
    });

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.posting.id).toBe("known");
    expect(result.deferred).toBe(1);
  });

  it("defers on budget 0 or an empty posting list without inspecting similarity", () => {
    const some = postings("p", 3);
    const zeroBudget = triage({
      postings: some,
      criteriaSimilarity: new Map(),
      profileSimilarity: new Map(),
      budget: 0
    });
    expect(zeroBudget.selected).toHaveLength(0);
    expect(zeroBudget.deferred).toBe(3);

    const empty = triage({
      postings: [],
      criteriaSimilarity: new Map(),
      profileSimilarity: new Map(),
      budget: 5
    });
    expect(empty.selected).toHaveLength(0);
    expect(empty.deferred).toBe(0);
  });
});
