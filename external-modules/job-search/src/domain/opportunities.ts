// external-modules/job-search/src/domain/opportunities.ts
//
// JS-02 (#931): opportunities repo. Upsert is idempotent on
// (identityHash, contentHash) so monitor retries are safe; a content change
// refreshes the posting but never clobbers user status (saved/passed are the
// user's, not the adapter's). An unexpired tombstone suppresses re-ingestion
// — that's what keeps retention-evicted postings from bouncing back on the
// next monitor run. Oversized descriptions truncate on a UTF-8 boundary and
// are flagged, never rejected (losing a posting over a long description
// would be worse than losing its tail).
import { JobSearchKvError } from "./errors.js";
import { contentHash, keys, opportunityIdentity } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import { DESCRIPTION_MAX_BYTES } from "./limits.js";
import { canonicalJson, readRecord, writeRecord } from "./records.js";

export type OpportunityStatus = "new" | "saved" | "active" | "passed" | "stale";

// JS-07 (#936): structured posting facts. All additive-optional on
// schemaVersion 1 — records.ts hard-pins the version, so a bump would brick
// every existing reader. Absent facts mean "unknown", never a default.
export interface PostingFacts {
  publishedAt?: string;
  workMode?: "remote" | "hybrid" | "onsite";
  employmentType?: string;
  compensation?: string;
}

export interface OpportunityRecord {
  schemaVersion: 1;
  identityHash: string;
  adapterId: string;
  externalId?: string;
  status: OpportunityStatus;
  statusAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  contentHash: string;
  // JS-07: 32-hex hash of (adapterId, board) — see keys.sourceKey. Optional
  // because pre-JS-07 records lack it; they stay freshness-"uncertain" until
  // re-seen by a monitor that stamps it.
  sourceKey?: string;
  // JS-07: absence means "uncertain" (freshnessOf) — never default "active".
  freshness?: "active" | "uncertain" | "stale";
  // Last time a successful fetch of this record's own board included it.
  lastLivenessAt?: string;
  posting: PostingFacts & {
    title: string;
    company: string;
    location?: string;
    url?: string;
    description: string;
    descriptionTruncated: boolean;
  };
}

// Compact by design: nothing here identifies the posting to a human.
export interface OpportunityTombstone {
  schemaVersion: 1;
  identityHash: string;
  adapterId: string;
  expiresAt: string;
}

export interface OpportunityInput {
  adapterId: string;
  externalId?: string;
  canonicalUrl?: string;
  // JS-07: supplied by the monitor run (it knows which board it fetched);
  // absent for callers with no board context (e.g. manual capture).
  sourceKey?: string;
  posting: PostingFacts & {
    title: string;
    company: string;
    location?: string;
    url?: string;
    description: string;
  };
}

export type UpsertOpportunityResult =
  | { suppressed: true }
  | { suppressed: false; record: OpportunityRecord };

const HASH_PATTERN = /^[0-9a-f]{32}$/;

/** Guard for identity hashes arriving from callers (they become key material). */
function assertHash(hash: string): void {
  if (!HASH_PATTERN.test(hash)) {
    throw new JobSearchKvError("invalid_record", "identity hash must be 32 lowercase hex chars");
  }
}

/**
 * Truncate to at most maxBytes of UTF-8 without splitting a code point:
 * back off past continuation bytes to the previous character boundary.
 */
// Exported for JS-04 adapters: descriptions are capped with the same
// UTF-8-boundary-safe truncation the repo applies on upsert.
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) {
    return { text, truncated: false };
  }
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) {
    end -= 1;
  }
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

const JOB_PREFIX = "job/";

/** Stored posting = input posting with the description capped; structured
 * facts (JS-07) pass through only when present so records never carry
 * undefined placeholders. */
function buildStoredPosting(
  posting: OpportunityInput["posting"],
  description: { text: string; truncated: boolean }
): OpportunityRecord["posting"] {
  return {
    title: posting.title,
    company: posting.company,
    ...(posting.location !== undefined ? { location: posting.location } : {}),
    ...(posting.url !== undefined ? { url: posting.url } : {}),
    ...(posting.publishedAt !== undefined ? { publishedAt: posting.publishedAt } : {}),
    ...(posting.workMode !== undefined ? { workMode: posting.workMode } : {}),
    ...(posting.employmentType !== undefined ? { employmentType: posting.employmentType } : {}),
    ...(posting.compensation !== undefined ? { compensation: posting.compensation } : {}),
    description: description.text,
    descriptionTruncated: description.truncated
  };
}

export async function upsertOpportunity(
  kv: JobSearchKv,
  input: OpportunityInput,
  now: Date
): Promise<UpsertOpportunityResult> {
  const identityHash = opportunityIdentity(input);

  // Tombstone gate first: an unexpired tombstone means the user's retention
  // pass evicted this posting — re-ingestion is suppressed until it expires.
  const tombstoneKey = keys.tombstone(identityHash);
  const tombstone = (await readRecord(
    kv,
    NS.opportunities,
    tombstoneKey
  )) as OpportunityTombstone | null;
  if (tombstone !== null) {
    if (tombstone.expiresAt > now.toISOString()) {
      return { suppressed: true };
    }
    await kv.delete(NS.opportunities, tombstoneKey);
  }

  // Hash the FULL posting (pre-truncation, canonicalized) so change detection
  // sees real content changes even past the stored description cap.
  const hash = contentHash(canonicalJson(input.posting));
  const description = truncateUtf8(input.posting.description, DESCRIPTION_MAX_BYTES);
  const nowIso = now.toISOString();

  const existing = (await readRecord(
    kv,
    NS.opportunities,
    keys.job(identityHash)
  )) as OpportunityRecord | null;

  // JS-07: any sighting refreshes the source binding — pre-JS-07 records
  // gain their sourceKey the first time a stamping monitor re-sees them.
  // An input without one (manual capture) preserves whatever is stored.
  const sourceBinding = input.sourceKey !== undefined ? { sourceKey: input.sourceKey } : {};

  let record: OpportunityRecord;
  if (existing === null) {
    record = {
      schemaVersion: 1,
      identityHash,
      adapterId: input.adapterId,
      ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
      ...sourceBinding,
      status: "new",
      statusAt: nowIso,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      contentHash: hash,
      posting: buildStoredPosting(input.posting, description)
    };
  } else if (existing.contentHash === hash) {
    // Idempotent retry: only the sighting timestamp (and source binding) move.
    record = { ...existing, ...sourceBinding, lastSeenAt: nowIso };
  } else {
    // Content changed: refresh posting + contentHash, preserve the user's
    // status/statusAt and the original firstSeenAt.
    record = {
      ...existing,
      ...sourceBinding,
      contentHash: hash,
      lastSeenAt: nowIso,
      posting: buildStoredPosting(input.posting, description)
    };
  }

  await writeRecord(kv, NS.opportunities, keys.job(identityHash), record);
  return { suppressed: false, record };
}

export async function getOpportunity(
  kv: JobSearchKv,
  identityHash: string
): Promise<OpportunityRecord | null> {
  assertHash(identityHash);
  const record = await readRecord(kv, NS.opportunities, keys.job(identityHash));
  return record as OpportunityRecord | null;
}

export async function listOpportunities(kv: JobSearchKv): Promise<readonly OpportunityRecord[]> {
  const allKeys = await kv.list(NS.opportunities);
  const records: OpportunityRecord[] = [];
  for (const key of allKeys) {
    if (!key.startsWith(JOB_PREFIX)) {
      continue;
    }
    const record = await readRecord(kv, NS.opportunities, key);
    if (record !== null) {
      records.push(record as unknown as OpportunityRecord);
    }
  }
  return records;
}

export async function setOpportunityStatus(
  kv: JobSearchKv,
  identityHash: string,
  status: OpportunityStatus,
  now: Date
): Promise<void> {
  assertHash(identityHash);
  const existing = (await readRecord(
    kv,
    NS.opportunities,
    keys.job(identityHash)
  )) as OpportunityRecord | null;
  if (existing === null) {
    throw new JobSearchKvError("missing_record", "opportunity not found for status change");
  }
  const record: OpportunityRecord = { ...existing, status, statusAt: now.toISOString() };
  await writeRecord(kv, NS.opportunities, keys.job(identityHash), record);
}
