export type ResumeSource = "upload" | "paste" | "interview";
export type ResumeRevisionKind = "source" | "review" | "approved";

export interface ResumeDiffRecord {
  readonly section: string;
  readonly before: string;
  readonly after: string;
}

export interface ResumeCritiqueItem {
  readonly section: string;
  readonly text: string;
}

export interface ResumeRevisionProposal extends ResumeDiffRecord {
  readonly evidence: string;
}

export interface ResumeStrength {
  readonly text: string;
  readonly evidence: string;
}

export interface ResumeGap {
  readonly text: string;
  readonly evidence?: string;
}

export interface ResumeReviewArtifact {
  readonly critique: readonly ResumeCritiqueItem[];
  readonly revisions: readonly ResumeRevisionProposal[];
  readonly strengths: readonly ResumeStrength[];
  readonly gaps: readonly ResumeGap[];
}

export interface ResumeReviewModelOutput {
  readonly critique?: readonly Record<string, unknown>[];
  readonly revisions?: readonly Record<string, unknown>[];
  readonly strengths?: readonly Record<string, unknown>[];
  readonly gaps?: readonly Record<string, unknown>[];
}

export interface ResumeRevision {
  readonly id: string;
  readonly version: number;
  readonly kind: ResumeRevisionKind;
  readonly source: ResumeSource;
  readonly sourceText: string;
  readonly createdAt: string;
  readonly diff: readonly ResumeDiffRecord[];
  readonly artifact?: ResumeReviewArtifact;
}

export interface ResumeCurrent {
  readonly revisionId: string;
  readonly source: ResumeSource;
  readonly status: "draft" | "approved";
  readonly text: string;
}

export interface ResumeRecord {
  readonly current: ResumeCurrent | null;
  readonly revisions: readonly ResumeRevision[];
}

const MAX_SECTION_LENGTH = 120;
const MAX_TEXT_LENGTH = 4_000;
const MAX_EVIDENCE_LENGTH = 2_000;
const MAX_ITEMS = 20;

export function createEmptyResume(): ResumeRecord {
  return { current: null, revisions: [] };
}

export function appendSourceRevision(
  record: ResumeRecord,
  input: {
    readonly id: string;
    readonly source: ResumeSource;
    readonly sourceText: string;
    readonly createdAt: string;
  }
): { readonly record: ResumeRecord; readonly revision: ResumeRevision } {
  const revision: ResumeRevision = {
    id: input.id,
    version: nextVersion(record),
    kind: "source",
    source: input.source,
    sourceText: input.sourceText,
    createdAt: input.createdAt,
    diff: []
  };
  return {
    revision,
    record: {
      current: {
        revisionId: revision.id,
        source: revision.source,
        status: "draft",
        text: revision.sourceText
      },
      revisions: [...record.revisions, revision]
    }
  };
}

export function appendReviewRevision(
  record: ResumeRecord,
  input: {
    readonly id: string;
    readonly source: ResumeSource;
    readonly sourceText: string;
    readonly artifact: ResumeReviewArtifact;
    readonly createdAt: string;
  }
): { readonly record: ResumeRecord; readonly revision: ResumeRevision } {
  const revision: ResumeRevision = {
    id: input.id,
    version: nextVersion(record),
    kind: "review",
    source: input.source,
    sourceText: input.sourceText,
    createdAt: input.createdAt,
    diff: input.artifact.revisions.map(({ section, before, after }) => ({
      section,
      before,
      after
    })),
    artifact: input.artifact
  };
  return { revision, record: { ...record, revisions: [...record.revisions, revision] } };
}

export function approveRevision(
  record: ResumeRecord,
  revisionId: string,
  approvedId: string,
  createdAt: string
): { readonly record: ResumeRecord; readonly revision: ResumeRevision } {
  const revision = record.revisions.find((candidate) => candidate.id === revisionId);
  if (!revision || revision.kind !== "review" || !revision.artifact) {
    throw new Error("unknown_revision");
  }
  const approved: ResumeRevision = {
    ...revision,
    id: approvedId,
    kind: "approved",
    sourceText: applyRevisions(revision.sourceText, revision.artifact.revisions),
    createdAt
  };
  return {
    revision: approved,
    record: {
      current: {
        revisionId: approved.id,
        source: approved.source,
        status: "approved",
        text: approved.sourceText
      },
      revisions: [...record.revisions, approved]
    }
  };
}

function applyRevisions(sourceText: string, revisions: readonly ResumeRevisionProposal[]): string {
  return revisions.reduce(
    (text, revision) =>
      text.includes(revision.before) ? text.replace(revision.before, revision.after) : text,
    sourceText
  );
}

export function sanitizeReviewArtifact(
  sourceText: string,
  candidate: unknown
): ResumeReviewArtifact {
  const value = asRecord(candidate);
  return {
    critique: readArray(value.critique, (item) => {
      const entry = asRecord(item);
      const section = readText(entry.section, MAX_SECTION_LENGTH);
      const text = readText(entry.text, MAX_TEXT_LENGTH);
      return section && text ? { section, text } : null;
    }),
    revisions: readArray(value.revisions, (item) => {
      const entry = asRecord(item);
      const section = readText(entry.section, MAX_SECTION_LENGTH);
      const before = readText(entry.before, MAX_TEXT_LENGTH);
      const after = readText(entry.after, MAX_TEXT_LENGTH);
      const evidence = readEvidence(entry.evidence, sourceText);
      return section && before && after && evidence ? { section, before, after, evidence } : null;
    }),
    strengths: readArray(value.strengths, (item) => {
      const entry = asRecord(item);
      const text = readText(entry.text, MAX_TEXT_LENGTH);
      const evidence = readEvidence(entry.evidence, sourceText);
      return text && evidence ? { text, evidence } : null;
    }),
    gaps: readArray(value.gaps, (item) => {
      const entry = asRecord(item);
      const text = readText(entry.text, MAX_TEXT_LENGTH);
      if (!text) return null;
      const evidence = readText(entry.evidence, MAX_EVIDENCE_LENGTH);
      return evidence ? { text, evidence } : { text };
    })
  };
}

export function parseResumeRecord(value: Record<string, unknown> | null): ResumeRecord | null {
  if (!value || !Array.isArray(value.revisions)) return null;
  const revisions = value.revisions.filter(isResumeRevision);
  if (revisions.length !== value.revisions.length) return null;
  const current = value.current;
  if (current !== null && !isResumeCurrent(current)) return null;
  return { current, revisions };
}

function nextVersion(record: ResumeRecord): number {
  return record.revisions.at(-1)?.version !== undefined ? record.revisions.at(-1)!.version + 1 : 0;
}

function readArray<T>(value: unknown, read: (value: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ITEMS).flatMap((item) => {
    const parsed = read(item);
    return parsed ? [parsed] : [];
  });
}

function readEvidence(value: unknown, sourceText: string): string | null {
  const evidence = readText(value, MAX_EVIDENCE_LENGTH);
  return evidence && sourceText.includes(evidence) ? evidence : null;
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isResumeCurrent(value: unknown): value is ResumeCurrent {
  const record = asRecord(value);
  return (
    typeof record.revisionId === "string" &&
    (record.source === "upload" || record.source === "paste" || record.source === "interview") &&
    (record.status === "draft" || record.status === "approved") &&
    typeof record.text === "string"
  );
}

function isResumeRevision(value: unknown): value is ResumeRevision {
  const record = asRecord(value);
  return (
    typeof record.id === "string" &&
    typeof record.version === "number" &&
    (record.kind === "source" || record.kind === "review" || record.kind === "approved") &&
    (record.source === "upload" || record.source === "paste" || record.source === "interview") &&
    typeof record.sourceText === "string" &&
    typeof record.createdAt === "string" &&
    Array.isArray(record.diff)
  );
}
