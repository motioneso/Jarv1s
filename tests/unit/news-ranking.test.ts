import { describe, expect, it } from "vitest";

import {
  featureEligible,
  rankStories,
  storyWeight,
  type RankableHeadline,
  type RankInput
} from "../../packages/news/src/ranking.js";

// #897: ranking decides what lands in the six top-stories slots, so the weights are product
// decisions, not incidental values — pin them (art +2, dek +1, feed lead +2).
function headline(overrides: Partial<RankableHeadline> = {}): RankableHeadline {
  return { imageUrl: null, summary: "", publishedAt: null, ...overrides };
}

function input<T extends RankableHeadline>(item: T, feedPosition: number): RankInput<T> {
  return { item, feedPosition };
}

describe("storyWeight (#897)", () => {
  it("scores a bare wire item 0", () => {
    expect(storyWeight(headline(), 3)).toBe(0);
  });

  it("adds +2 for artwork, +1 for a dek, +2 for the feed's lead slot", () => {
    expect(storyWeight(headline({ imageUrl: "https://x/i.png" }), 3)).toBe(2);
    expect(storyWeight(headline({ summary: "dek" }), 3)).toBe(1);
    expect(storyWeight(headline(), 0)).toBe(2);
  });

  it("maxes at 5 when everything stacks", () => {
    expect(storyWeight(headline({ imageUrl: "https://x/i.png", summary: "dek" }), 0)).toBe(5);
  });
});

describe("rankStories (#897)", () => {
  it("orders by weight descending", () => {
    const light = headline({ publishedAt: "2026-07-08T12:00:00.000Z" });
    const heavy = headline({ imageUrl: "https://x/i.png", summary: "dek" });
    expect(rankStories([input(light, 1), input(heavy, 1)])).toEqual([heavy, light]);
  });

  it("breaks weight ties by publishedAt descending (newest first)", () => {
    const older = headline({ publishedAt: "2026-07-08T08:00:00.000Z" });
    const newer = headline({ publishedAt: "2026-07-08T20:00:00.000Z" });
    expect(rankStories([input(older, 1), input(newer, 1)])).toEqual([newer, older]);
  });

  it("sorts undated items after dated ones at equal weight", () => {
    // null → "" in the ISO-string compare, and "" sorts after any real timestamp descending.
    const undated = headline();
    const dated = headline({ publishedAt: "2026-07-08T08:00:00.000Z" });
    expect(rankStories([input(undated, 1), input(dated, 1)])).toEqual([dated, undated]);
  });

  it("is stable: full ties keep input order (feed order is the editorial fallback)", () => {
    const a = headline({ publishedAt: "2026-07-08T08:00:00.000Z" });
    const b = headline({ publishedAt: "2026-07-08T08:00:00.000Z" });
    const c = headline({ publishedAt: "2026-07-08T08:00:00.000Z" });
    expect(rankStories([input(a, 1), input(b, 2), input(c, 3)])).toEqual([a, b, c]);
  });

  it("does not mutate its input", () => {
    const inputs = [input(headline(), 1), input(headline({ summary: "dek" }), 2)];
    const before = [...inputs];
    rankStories(inputs);
    expect(inputs).toEqual(before);
  });
});

describe("featureEligible (#897)", () => {
  it("requires BOTH artwork and a dek — the feature slot renders both", () => {
    expect(featureEligible(headline({ imageUrl: "https://x/i.png", summary: "dek" }))).toBe(true);
    expect(featureEligible(headline({ imageUrl: "https://x/i.png" }))).toBe(false);
    expect(featureEligible(headline({ summary: "dek" }))).toBe(false);
    expect(featureEligible(headline())).toBe(false);
  });
});
