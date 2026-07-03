import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const eveningSource = readFileSync(
  resolve(here, "../../packages/briefings/src/compose-evening.ts"),
  "utf8"
);

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

describe("evening prompt embeds the shared headers verbatim", () => {
  it("names every EVENING_SECTION_HEADERS value inside the synthesis literal", () => {
    for (const header of Object.values(EVENING_SECTION_HEADERS)) {
      expect(eveningSource, `prompt literal must contain "${header}"`).toContain(`"${header}"`);
    }
  });
});
