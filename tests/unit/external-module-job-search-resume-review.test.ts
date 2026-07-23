import { describe, expect, it } from "vitest";

import {
  critiqueSections,
  resumeReviewFromResult,
  reviewClaimCount,
  reviewSummary
} from "../../external-modules/job-search/src/web/resume-review-model.js";

describe("Job Search resume review model (#1233)", () => {
  it("keeps only the review fields the artifact can render", () => {
    const review = resumeReviewFromResult({
      revisionId: "review-1",
      artifact: {
        critique: [
          { section: "Summary", text: "Lead with the migration outcome.", secret: "drop" }
        ],
        revisions: [
          {
            section: "Summary",
            before: "Led a migration",
            after: "Led a platform migration.",
            evidence: "Led a migration"
          }
        ],
        strengths: [{ text: "Migration leadership", evidence: "Led a migration" }],
        gaps: [{ text: "Cloud certification", evidence: "AWS certification" }]
      },
      privateText: "must not render"
    });

    expect(review).toEqual({
      revisionId: "review-1",
      critique: [{ section: "Summary", text: "Lead with the migration outcome." }],
      revisions: [
        {
          section: "Summary",
          before: "Led a migration",
          after: "Led a platform migration.",
          evidence: "Led a migration"
        }
      ],
      strengths: [{ text: "Migration leadership", evidence: "Led a migration" }],
      gaps: [{ text: "Cloud certification", evidence: "AWS certification" }]
    });
  });

  it("groups critique by section and writes an honest deterministic summary", () => {
    const review = resumeReviewFromResult({
      revisionId: "review-1",
      artifact: {
        critique: [
          { section: "Experience", text: "Make the outcome easier to scan." },
          { section: "Experience", text: "Keep the scope visible." },
          { section: "Summary", text: "Lead with the strongest evidence." }
        ],
        revisions: [],
        strengths: [{ text: "Migration leadership", evidence: "Led a migration" }],
        gaps: [{ text: "Cloud certification" }]
      }
    });
    if (!review) throw new Error("expected review");

    expect(critiqueSections(review)).toEqual([
      {
        section: "Experience",
        items: ["Make the outcome easier to scan.", "Keep the scope visible."]
      },
      { section: "Summary", items: ["Lead with the strongest evidence."] }
    ]);
    expect(reviewClaimCount(review)).toEqual({ verifiable: 1, total: 1 });
    expect(reviewSummary(review)).toBe(
      "I led with “Led a migration”, made 0 tracked changes, and flagged 1 item to source before citing."
    );
  });

  it("rejects malformed or private-only tool results", () => {
    expect(resumeReviewFromResult({ revisionId: "review-1", artifact: {} })).toBeNull();
    expect(resumeReviewFromResult({ artifact: { critique: [] } })).toBeNull();
  });
});
