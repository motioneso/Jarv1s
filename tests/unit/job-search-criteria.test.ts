// tests/unit/job-search-criteria.test.ts
//
// Task 10 (#1294): `parseCriteria` and `parseContextSummary` are strict admission gates —
// nothing is invented, nothing is coerced, and onboarding progress is derived from the
// stored record rather than trusted from a model's claim.
import { describe, expect, it } from "vitest";

import {
  CONTEXT_SUMMARY_MAX,
  completedSteps,
  isReadyToCrawl,
  parseContextSummary,
  parseCriteria,
  parseCriteriaPatch,
  withCriteriaDefaults
} from "../../external-modules/job-search/src/domain/criteria.js";

describe("job-search parseCriteria (#1294)", () => {
  it("an unknown remote value is rejected rather than defaulted", () => {
    expect(() => parseCriteria({ remote: "maybe" })).toThrow(/remote must be one of/);
  });

  it("absent list fields become [] and absent scalars default with nothing invented", () => {
    const criteria = parseCriteria({ titles: ["Staff Engineer"] });

    expect(criteria.titles).toEqual(["Staff Engineer"]);
    expect(criteria.dealbreakers).toEqual([]);
    expect(criteria.compFloorCents).toBeNull();
  });

  it("rejects a field the model invented", () => {
    expect(() => parseCriteria({ overall: 87 })).toThrow(/unexpected field: overall/);
  });
});

describe("job-search completedSteps / isReadyToCrawl (#1294)", () => {
  it("a step counts as done only when its field actually holds something", () => {
    const steps = completedSteps(
      { titles: ["Staff Engineer"], wantNarrative: "senior IC role" },
      0
    );

    expect(steps).toEqual(["role", "want"]);
  });

  it("sources is counted from enabled portals, not criteria", () => {
    expect(completedSteps({}, 2)).toEqual(["sources"]);
  });

  it("ready-to-crawl needs a role, a want, and at least one source", () => {
    const roleAndWant = { titles: ["Staff Engineer"], wantNarrative: "senior IC role" };

    expect(isReadyToCrawl(roleAndWant, 1)).toBe(true);
    expect(isReadyToCrawl(roleAndWant, 0)).toBe(false);
    expect(isReadyToCrawl({ titles: ["Staff Engineer"] }, 1)).toBe(false);
  });
});

describe("job-search parseContextSummary (#1294)", () => {
  it("a short context summary is accepted and trimmed", () => {
    expect(parseContextSummary("  Looking for senior IC roles, not management.  ")).toBe(
      "Looking for senior IC roles, not management."
    );
  });

  it("a summary over the cap is rejected, not truncated", () => {
    const tooLong = "a".repeat(CONTEXT_SUMMARY_MAX + 1);

    expect(() => parseContextSummary(tooLong)).toThrow(
      /context summary must be 1200 characters or fewer/
    );
  });

  it("an empty or whitespace-only summary is rejected", () => {
    expect(() => parseContextSummary("   ")).toThrow();
  });

  it("control characters are rejected, newlines included", () => {
    // \x00 written as an escape deliberately, not a literal NUL byte — a literal NUL in
    // this source file makes git treat it as binary (no diff, no blame). Behaviour is
    // identical either way; do not "simplify" this back into a literal byte.
    expect(() => parseContextSummary("has a\x00nul in it")).toThrow(
      /must not contain control characters/
    );
    expect(() => parseContextSummary("has a\nnewline in it")).toThrow(
      /must not contain control characters/
    );
  });

  it("a non-string is rejected", () => {
    expect(() => parseContextSummary({ text: "hi" })).toThrow();
  });
});

describe("job-search parseCriteriaPatch", () => {
  // The live regression this suite exists for: the user gave every answer in one message, the
  // model called criteria.set with `{}` to acknowledge it, the record was overwritten with
  // defaults, and the tool card said "Resolved." A save that saves nothing must not succeed.
  it("an empty patch is rejected rather than saved as a no-op", () => {
    expect(() => parseCriteriaPatch({})).toThrow(/at least one field/);
  });

  it("returns only the fields that were sent, so a merge cannot erase the rest", () => {
    const patch = parseCriteriaPatch({ titles: ["Senior Product Designer"] });

    expect(patch).toEqual({ titles: ["Senior Product Designer"] });
    // Named individually rather than by key count: these are exactly the fields a whole-object
    // parse would have defaulted, and defaulting any one of them is the bug.
    expect(patch.wantNarrative).toBeUndefined();
    expect(patch.remote).toBeUndefined();
    expect(patch.compFloorCents).toBeUndefined();
    expect(patch.dealbreakers).toBeUndefined();
  });

  it("an explicitly empty list is a clear, not an absence", () => {
    // Present-keys-win has to keep working in the other direction too, or there would be no way
    // to remove a title the user has changed their mind about.
    expect(parseCriteriaPatch({ titles: [] })).toEqual({ titles: [] });
  });

  it("rejects everything a full parse rejects", () => {
    expect(() => parseCriteriaPatch({ remote: "maybe" })).toThrow(/remote must be one of/);
    expect(() => parseCriteriaPatch({ overall: 5 })).toThrow(/unexpected field/);
    expect(() => parseCriteriaPatch({ titles: [7] })).toThrow(/array of strings/);
    expect(() => parseCriteriaPatch("nope")).toThrow(/must be an object/);
  });
});

describe("job-search withCriteriaDefaults", () => {
  // The live crash this suite exists for: once `criteria.set` started merging instead of replacing,
  // a profile part-way through the interview held only the answered keys. The crawl read it back
  // with a bare cast and died on `applyHardExcludes` — "Cannot read properties of undefined
  // (reading 'map')" — after the user had answered everything and the search had gone active.
  it("a record missing keys comes back whole", () => {
    const filled = withCriteriaDefaults({ titles: ["Staff Engineer"] });

    expect(filled.titles).toEqual(["Staff Engineer"]);
    expect(filled.excludeCompanies).toEqual([]);
    expect(filled.dealbreakers).toEqual([]);
    expect(filled.mustHave).toEqual([]);
    expect(filled.niceToHave).toEqual([]);
    expect(filled.seniority).toEqual([]);
    expect(filled.locations).toEqual([]);
    expect(filled.remote).toBe("no-preference");
    expect(filled.compFloorCents).toBeNull();
    expect(filled.wantNarrative).toBe("");
  });

  it("never throws on the read path, however bad the stored row is", () => {
    // Unlike `parseCriteria`, this runs while loading a profile — throwing here would blank the
    // screen instead of showing the user what they had already said.
    expect(() => withCriteriaDefaults(null)).not.toThrow();
    expect(withCriteriaDefaults(undefined).titles).toEqual([]);
    expect(withCriteriaDefaults({ titles: 7 } as never).titles).toEqual([]);
    expect(withCriteriaDefaults({ remote: "maybe" } as never).remote).toBe("no-preference");
  });

  it("keeps every answered value untouched", () => {
    const stored = { remote: "preferred" as const, compFloorCents: 18000000, wantNarrative: "hi" };

    expect(withCriteriaDefaults(stored)).toMatchObject(stored);
  });
});
