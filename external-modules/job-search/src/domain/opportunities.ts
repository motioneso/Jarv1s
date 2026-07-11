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
  posting: {
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
  posting: {
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

  let record: OpportunityRecord;
  if (existing === null) {
    record = {
      schemaVersion: 1,
      identityHash,
      adapterId: input.adapterId,
      ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
      status: "new",
      statusAt: nowIso,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      contentHash: hash,
      posting: {
        title: input.posting.title,
        company: input.posting.company,
        ...(input.posting.location !== undefined ? { location: input.posting.location } : {}),
        ...(input.posting.url !== undefined ? { url: input.posting.url } : {}),
        description: description.text,
        descriptionTruncated: description.truncated
      }
    };
  } else if (existing.contentHash === hash) {
    // Idempotent retry: only the sighting timestamp moves.
    record = { ...existing, lastSeenAt: nowIso };
  } else {
    // Content changed: refresh posting + contentHash, preserve the user's
    // status/statusAt and the original firstSeenAt.
    record = {
      ...existing,
      contentHash: hash,
      lastSeenAt: nowIso,
      posting: {
        title: input.posting.title,
        company: input.posting.company,
        ...(input.posting.location !== undefined ? { location: input.posting.location } : {}),
        ...(input.posting.url !== undefined ? { url: input.posting.url } : {}),
        description: description.text,
        descriptionTruncated: description.truncated
      }
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
