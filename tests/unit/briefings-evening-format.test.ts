import { describe, expect, it } from "vitest";

import {
  EVENING_FALLBACK_QUESTIONS,
  EVENING_SECTION_HEADERS
} from "../../packages/shared/src/briefings-format.js";

describe("evening briefing format constants", () => {
  it("locks the six section headers to the spec vocabulary, in order", () => {
    expect(Object.values(EVENING_SECTION_HEADERS)).toEqual([
      "What got done",
      "What slipped",
      "Carrying forward",
      "Needs your attention",
      "Tomorrow",
      "News & sports"
    ]);
  });

  it("provides exactly two canned fallback reflection questions", () => {
    expect(EVENING_FALLBACK_QUESTIONS).toHaveLength(2);
    for (const q of EVENING_FALLBACK_QUESTIONS) {
      expect(q.endsWith("?")).toBe(true);
    }
  });
});
