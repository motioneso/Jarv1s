// external-modules/job-search/src/domain/resume.ts
//
// JS-02 (#931): resume revision repo. The pasted original is written once at
// revision/0 (kind "original") and retained unchanged forever; AI-derived
// markdown revisions get their own ids and may never claim "0". Both entry
// points enforce the 48 KB input gate BEFORE any write — the rejection copy
// (RESUME_TOO_LARGE_MESSAGE) is a spec contract surfaced verbatim by JS-03.
// Approval writes ONLY the `active` pointer; a pointer whose revision record
// is missing fails closed (missing_active_pointer), never silently null.
import { JobSearchKvError } from "./errors.js";
import { assertId, keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import { RESUME_INPUT_MAX_BYTES, RESUME_TOO_LARGE_MESSAGE } from "./limits.js";
import { canonicalJson, readRecord, writeRecord } from "./records.js";

export interface ResumeRevision {
  schemaVersion: 1;
  revisionId: string;
  kind: "original" | "markdown";
  content: string;
  parentRevisionId?: string;
  critiqueSummary?: string;
  evidence?: readonly string[];
  createdAt: string;
}

export interface ResumeActivePointer {
  schemaVersion: 1;
  revisionId: string;
  approvedAt: string;
}

const ORIGINAL_REVISION_ID = "0";

// Message is the fixed spec copy — never append sizes derived from content.
function assertResumeInputSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > RESUME_INPUT_MAX_BYTES) {
    throw new JobSearchKvError("resume_input_too_large", RESUME_TOO_LARGE_MESSAGE);
  }
}

async function writeImmutableRevision(kv: JobSearchKv, rev: ResumeRevision): Promise<void> {
  const key = keys.resumeRevision(rev.revisionId);
  const existing = await readRecord(kv, NS.resume, key);
  if (existing !== null) {
    if (canonicalJson(existing) === canonicalJson(rev)) {
      return; // idempotent re-save
    }
    throw new JobSearchKvError(
      "immutable_revision_conflict",
      `resume revision ${rev.revisionId} already exists with different content`
    );
  }
  await writeRecord(kv, NS.resume, key, rev);
}

export async function saveOriginalResume(
  kv: JobSearchKv,
  content: string,
  createdAt: Date
): Promise<void> {
  assertResumeInputSize(content);
  await writeImmutableRevision(kv, {
    schemaVersion: 1,
    revisionId: ORIGINAL_REVISION_ID,
    kind: "original",
    content,
    createdAt: createdAt.toISOString()
  });
}

export async function saveResumeRevision(kv: JobSearchKv, rev: ResumeRevision): Promise<void> {
  assertId(rev.revisionId);
  if (rev.revisionId === ORIGINAL_REVISION_ID) {
    throw new JobSearchKvError(
      "invalid_record",
      "resume revision id 0 is reserved for the immutable original"
    );
  }
  assertResumeInputSize(rev.content);
  await writeImmutableRevision(kv, rev);
}

export async function approveResume(
  kv: JobSearchKv,
  revisionId: string,
  approvedAt: Date
): Promise<void> {
  assertId(revisionId);
  const revision = await readRecord(kv, NS.resume, keys.resumeRevision(revisionId));
  if (revision === null) {
    throw new JobSearchKvError("missing_revision", `resume revision ${revisionId} not found`);
  }
  const pointer: ResumeActivePointer = {
    schemaVersion: 1,
    revisionId,
    approvedAt: approvedAt.toISOString()
  };
  await writeRecord(kv, NS.resume, keys.resumeActive, pointer);
}

export async function getActiveResume(kv: JobSearchKv): Promise<ResumeRevision | null> {
  const pointer = (await readRecord(
    kv,
    NS.resume,
    keys.resumeActive
  )) as ResumeActivePointer | null;
  if (pointer === null) {
    return null;
  }
  const revision = await readRecord(kv, NS.resume, keys.resumeRevision(pointer.revisionId));
  if (revision === null) {
    throw new JobSearchKvError(
      "missing_active_pointer",
      "active resume pointer references a missing revision"
    );
  }
  return revision as unknown as ResumeRevision;
}
