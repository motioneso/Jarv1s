// external-modules/job-search/src/domain/profile.ts
//
// JS-02 (#931): profile revision repo. Revisions are immutable history —
// a byte-identical re-save is an idempotent no-op (safe retries), changed
// content under the same id is a conflict. Approval writes ONLY the `active`
// pointer; revision records are never rewritten by approval. A pointer whose
// revision record is missing fails closed (missing_active_pointer), never
// silently null — silent null would let a corrupted state masquerade as
// "no profile yet" and trigger re-onboarding over live data.
import { JobSearchKvError } from "./errors.js";
import { assertId, keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import { canonicalJson, readRecord, writeRecord } from "./records.js";

export interface ProfileRevision {
  schemaVersion: 1;
  revisionId: string;
  createdAt: string;
  provenance: "user" | "inferred";
  fields: Record<string, unknown>;
}

export interface ActivePointer {
  schemaVersion: 1;
  revisionId: string;
  approvedAt: string;
}

const REVISION_PREFIX = "revision/";

export async function saveProfileRevision(kv: JobSearchKv, rev: ProfileRevision): Promise<void> {
  assertId(rev.revisionId);
  const key = keys.profileRevision(rev.revisionId);
  const existing = await readRecord(kv, NS.profile, key);
  if (existing !== null) {
    if (canonicalJson(existing) === canonicalJson(rev)) {
      return; // idempotent re-save
    }
    throw new JobSearchKvError(
      "immutable_revision_conflict",
      `profile revision ${rev.revisionId} already exists with different content`
    );
  }
  await writeRecord(kv, NS.profile, key, rev);
}

export async function approveProfile(
  kv: JobSearchKv,
  revisionId: string,
  approvedAt: Date
): Promise<void> {
  assertId(revisionId);
  const revision = await readRecord(kv, NS.profile, keys.profileRevision(revisionId));
  if (revision === null) {
    throw new JobSearchKvError("missing_revision", `profile revision ${revisionId} not found`);
  }
  const pointer: ActivePointer = {
    schemaVersion: 1,
    revisionId,
    approvedAt: approvedAt.toISOString()
  };
  await writeRecord(kv, NS.profile, keys.profileActive, pointer);
}

export async function getActiveProfile(kv: JobSearchKv): Promise<ProfileRevision | null> {
  const pointer = (await readRecord(kv, NS.profile, keys.profileActive)) as ActivePointer | null;
  if (pointer === null) {
    return null;
  }
  const revision = await readRecord(kv, NS.profile, keys.profileRevision(pointer.revisionId));
  if (revision === null) {
    throw new JobSearchKvError(
      "missing_active_pointer",
      "active profile pointer references a missing revision"
    );
  }
  return revision as unknown as ProfileRevision;
}

export async function listProfileRevisionIds(kv: JobSearchKv): Promise<readonly string[]> {
  const allKeys = await kv.list(NS.profile);
  return allKeys
    .filter((k) => k.startsWith(REVISION_PREFIX))
    .map((k) => k.slice(REVISION_PREFIX.length));
}
