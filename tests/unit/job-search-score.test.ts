// tests/unit/job-search-score.test.ts
//
// Task 9 (#1293): pins the two-axis score schema, the prompt that keeps Fit and Want
// independent, and the parser that refuses to let a blended score reach a row. Fit/Want must
// never merge — that is the module's single most important invariant, and this file is where
// the pressure to "just rank them" is strongest, so several cases exist purely to catch a
// well-meaning collapse back into one number.
import { describe, expect, it } from "vitest";

import type {
  Posting,
  SearchCriteria
} from "../../external-modules/job-search/src/domain/records.js";
import {
  buildScorePrompt,
  parseScoreResult,
  SCORE_SCHEMA
} from "../../external-modules/job-search/src/domain/score.js";

const posting: Posting = {
  id: "posting-1",
  sourceId: "linkedin",
  externalId: "ext-1",
  title: "Staff Backend Engineer",
  company: "Acme Corp",
  location: "Remote",
  url: "https://example.com/jobs/1",
  body: "Own the payments platform. Small team, high autonomy, on-call rotation.",
  postedAt: "2026-07-20T09:00:00.000Z"
};

const criteria: SearchCriteria = {
  titles: ["Staff Engineer"],
  seniority: ["staff"],
  locations: ["Remote"],
  remote: "required",
  compFloorCents: 18_000_000,
  excludeCompanies: [],
  mustHave: [],
  niceToHave: [],
  dealbreakers: ["no on-call", "no return to office"],
  wantNarrative: "Wants a small, autonomous team with real ownership and a calm on-call load."
};

describe("job-search SCORE_SCHEMA (#1293)", () => {
  it("has exactly the two axes and their reasons", () => {
    expect(Object.keys(SCORE_SCHEMA.properties).sort()).toEqual([
      "fit",
      "fitReason",
      "want",
      "wantReason"
    ]);
  });

  it("refuses unknown properties, so a model cannot invent an overall score", () => {
    expect(SCORE_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("job-search parseScoreResult (#1293)", () => {
  it("round-trips a well-formed result unchanged", () => {
    const result = parseScoreResult({
      fit: 72,
      want: 41,
      fitReason:
        "Ten years of payments experience directly matches the stack named in the posting.",
      wantReason:
        "Team size and on-call cadence match, but the posting names a five-year roadmap they didn't ask for."
    });

    expect(result).toEqual({
      fit: 72,
      want: 41,
      fitReason:
        "Ten years of payments experience directly matches the stack named in the posting.",
      wantReason:
        "Team size and on-call cadence match, but the posting names a five-year roadmap they didn't ask for."
    });
  });

  it("throws rather than clamping a score outside 0..100", () => {
    expect(() =>
      parseScoreResult({
        fit: 140,
        want: 50,
        fitReason: "reason",
        wantReason: "reason"
      })
    ).toThrow(/fit must be an integer between 0 and 100/);
  });

  it("throws on a non-integer score", () => {
    expect(() =>
      parseScoreResult({
        fit: 82.5,
        want: 50,
        fitReason: "reason",
        wantReason: "reason"
      })
    ).toThrow(/fit must be an integer between 0 and 100/);
  });

  it("throws on an empty reason", () => {
    expect(() =>
      parseScoreResult({
        fit: 50,
        want: 50,
        fitReason: "",
        wantReason: "reason"
      })
    ).toThrow();
  });

  it("throws on an extra blended field, naming it", () => {
    expect(() =>
      parseScoreResult({
        fit: 80,
        want: 60,
        fitReason: "reason",
        wantReason: "reason",
        overall: 87
      })
    ).toThrow(/unexpected field: overall/);
  });
});

describe("job-search buildScorePrompt (#1293)", () => {
  it("asks for the two axes independently and forbids averaging", () => {
    const prompt = buildScorePrompt({
      posting,
      criteria,
      resume:
        "Ten years building payments infrastructure at scale, most recently at a Series C fintech.",
      context: "Actively looking; prefers small teams."
    });

    expect(prompt).toContain(posting.title);
    expect(prompt).toContain(
      "Ten years building payments infrastructure at scale, most recently at a Series C fintech."
    );
    expect(prompt).toContain(criteria.wantNarrative);
    expect(prompt).toMatch(/do not (average|combine|blend)/i);
    expect(prompt).toContain("a year in");
  });

  it("omits the Dealbreakers line entirely when there are none", () => {
    const prompt = buildScorePrompt({
      posting,
      criteria: { ...criteria, dealbreakers: [] },
      resume: "Resume text.",
      context: "Context text."
    });

    expect(prompt).not.toMatch(/Dealbreakers:/);
  });
});
