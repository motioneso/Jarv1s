import { describe, expect, it } from "vitest";

import {
  appendReviewRevision,
  appendSourceRevision,
  createEmptyResume,
  sanitizeReviewArtifact,
  type ResumeReviewModelOutput
} from "../../external-modules/job-search/src/domain/resume.js";

const sourceText = [
  "Led a migration from a legacy platform to a service-oriented architecture.",
  "Managed a team of six engineers."
].join("\n");

describe("Job Search resume domain (#1233)", () => {
  it("stores intake as revision zero and keeps current owner-scoped text", () => {
    const result = appendSourceRevision(createEmptyResume(), {
      id: "resume-0",
      source: "paste",
      sourceText,
      createdAt: "2026-07-23T12:00:00.000Z"
    });

    expect(result.record.current).toEqual({
      revisionId: "resume-0",
      source: "paste",
      status: "draft",
      text: sourceText
    });
    expect(result.record.revisions).toHaveLength(1);
    expect(result.record.revisions[0]).toMatchObject({
      id: "resume-0",
      version: 0,
      kind: "source",
      sourceText,
      diff: []
    });
  });

  it("appends a versioned review diff without mutating earlier revisions", () => {
    const source = appendSourceRevision(createEmptyResume(), {
      id: "resume-0",
      source: "paste",
      sourceText,
      createdAt: "2026-07-23T12:00:00.000Z"
    });
    const artifact = sanitizeReviewArtifact(sourceText, {
      critique: [{ section: "Experience", text: "Your migration leadership is clear." }],
      revisions: [
        {
          section: "Summary",
          before: "Led a migration",
          after: "Led a platform migration that improved system reliability.",
          evidence: "Led a migration"
        }
      ],
      strengths: [{ text: "Migration leadership", evidence: "Led a migration" }],
      gaps: []
    });

    const review = appendReviewRevision(source.record, {
      id: "review-1",
      source: "paste",
      sourceText,
      artifact,
      createdAt: "2026-07-23T12:01:00.000Z"
    });

    expect(source.record.revisions).toHaveLength(1);
    expect(review.record.revisions).toHaveLength(2);
    expect(review.record.revisions[1]).toMatchObject({
      id: "review-1",
      version: 1,
      kind: "review",
      diff: [
        {
          section: "Summary",
          before: "Led a migration",
          after: "Led a platform migration that improved system reliability."
        }
      ]
    });
  });

  it("drops fabricated evidence and unknown model keys structurally", () => {
    const modelOutput: ResumeReviewModelOutput & { secret?: string } = {
      secret: "must not persist",
      critique: [
        {
          section: "Summary",
          text: "The summary needs a clearer outcome.",
          extra: "drop"
        }
      ],
      revisions: [
        {
          section: "Experience",
          before: "Managed a team",
          after: "Managed a six-person engineering team.",
          evidence: "Managed a team of six engineers.",
          prompt: "drop"
        },
        {
          section: "Experience",
          before: "Built a global team",
          after: "Built a global team of 50.",
          evidence: "Built a global team of 50."
        }
      ],
      strengths: [
        {
          text: "Migration leadership",
          evidence: "Led a migration from a legacy platform to a service-oriented architecture.",
          confidence: 1
        },
        { text: "Revenue growth", evidence: "Increased revenue by 40%." }
      ],
      gaps: [{ text: "Cloud certification", evidence: "AWS certification" }]
    };

    expect(sanitizeReviewArtifact(sourceText, modelOutput)).toEqual({
      critique: [{ section: "Summary", text: "The summary needs a clearer outcome." }],
      revisions: [
        {
          section: "Experience",
          before: "Managed a team",
          after: "Managed a six-person engineering team.",
          evidence: "Managed a team of six engineers."
        }
      ],
      strengths: [
        {
          text: "Migration leadership",
          evidence: "Led a migration from a legacy platform to a service-oriented architecture."
        }
      ],
      gaps: [{ text: "Cloud certification", evidence: "AWS certification" }]
    });
  });
});
