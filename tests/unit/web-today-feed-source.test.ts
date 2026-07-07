import { describe, expect, it } from "vitest";

import { createEmptyTodayFeed, isTodayFeedEmpty } from "../../apps/web/src/today/feed-source.js";

describe("Today feed source", () => {
  it("uses an explicit empty production feed instead of bundled demo stories", () => {
    const feed = createEmptyTodayFeed();

    expect(feed.overnight).toEqual([]);
    expect(feed.news).toEqual([]);
    expect(feed.interests).toEqual([]);
    expect(isTodayFeedEmpty(feed)).toBe(true);
  });
});
