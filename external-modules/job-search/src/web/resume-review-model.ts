export interface ResumeReviewItem {
  readonly section: string;
  readonly text: string;
}

export interface ResumeReviewRevision {
  readonly section: string;
  readonly before: string;
  readonly after: string;
  readonly evidence: string;
}

export interface ResumeReviewStrength {
  readonly text: string;
  readonly evidence: string;
}

export interface ResumeReviewGap {
  readonly text: string;
  readonly evidence?: string;
}

export interface ResumeReview {
  readonly revisionId: string;
  readonly critique: readonly ResumeReviewItem[];
  readonly revisions: readonly ResumeReviewRevision[];
  readonly strengths: readonly ResumeReviewStrength[];
  readonly gaps: readonly ResumeReviewGap[];
}

export function resumeReviewFromResult(value: unknown): ResumeReview | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  if (
    typeof result.revisionId !== "string" ||
    !result.artifact ||
    typeof result.artifact !== "object"
  ) {
    return null;
  }
  const artifact = result.artifact as Record<string, unknown>;
  if (
    !Array.isArray(artifact.critique) ||
    !Array.isArray(artifact.revisions) ||
    !Array.isArray(artifact.strengths) ||
    !Array.isArray(artifact.gaps)
  ) {
    return null;
  }

  return {
    revisionId: result.revisionId,
    critique: readItems(artifact.critique),
    revisions: readRevisions(artifact.revisions),
    strengths: readStrengths(artifact.strengths),
    gaps: readGaps(artifact.gaps)
  };
}

export function critiqueSections(review: ResumeReview): readonly {
  readonly section: string;
  readonly items: readonly string[];
}[] {
  const sections: { section: string; items: string[] }[] = [];
  for (const item of review.critique) {
    const existing = sections.find((candidate) => candidate.section === item.section);
    if (existing) existing.items.push(item.text);
    else sections.push({ section: item.section, items: [item.text] });
  }
  return sections;
}

export function reviewClaimCount(review: ResumeReview): {
  readonly verifiable: number;
  readonly total: number;
} {
  const verifiable = review.strengths.length + review.revisions.length;
  return { verifiable, total: verifiable };
}

export function reviewSummary(review: ResumeReview): string {
  const lead = review.strengths[0]?.evidence ?? "the evidence already in your résumé";
  const changes = review.revisions.length;
  const gaps = review.gaps.length;
  return `I led with “${lead}”, made ${changes} tracked change${changes === 1 ? "" : "s"}, and flagged ${gaps} item${gaps === 1 ? "" : "s"} to source before citing.`;
}

function readItems(value: readonly unknown[]): ResumeReviewItem[] {
  return value.flatMap((item) => {
    const entry = asRecord(item);
    return typeof entry.section === "string" &&
      typeof entry.text === "string" &&
      entry.section &&
      entry.text
      ? [{ section: entry.section, text: entry.text }]
      : [];
  });
}

function readRevisions(value: readonly unknown[]): ResumeReviewRevision[] {
  return value.flatMap((item) => {
    const entry = asRecord(item);
    return typeof entry.section === "string" &&
      typeof entry.before === "string" &&
      typeof entry.after === "string" &&
      typeof entry.evidence === "string" &&
      entry.section &&
      entry.before &&
      entry.after &&
      entry.evidence
      ? [
          {
            section: entry.section,
            before: entry.before,
            after: entry.after,
            evidence: entry.evidence
          }
        ]
      : [];
  });
}

function readStrengths(value: readonly unknown[]): ResumeReviewStrength[] {
  return value.flatMap((item) => {
    const entry = asRecord(item);
    return typeof entry.text === "string" &&
      typeof entry.evidence === "string" &&
      entry.text &&
      entry.evidence
      ? [{ text: entry.text, evidence: entry.evidence }]
      : [];
  });
}

function readGaps(value: readonly unknown[]): ResumeReviewGap[] {
  return value.flatMap((item) => {
    const entry = asRecord(item);
    if (typeof entry.text !== "string" || !entry.text) return [];
    return typeof entry.evidence === "string" && entry.evidence
      ? [{ text: entry.text, evidence: entry.evidence }]
      : [{ text: entry.text }];
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
