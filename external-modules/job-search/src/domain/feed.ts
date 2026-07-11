// external-modules/job-search/src/domain/feed.ts
//
// JS-02 (#931): feed index. Purely DERIVED state rebuilt from job/*
// canonical records — a lost or corrupt index never loses a posting.
// readFeed fails closed with corrupt_index on any stored-shape drift;
// readFeedOrRebuild catches exactly that (and absence) and repairs.
// Entries are compact {h, r, s} — no titles, companies, or URLs, so the
// index leaks nothing beyond what job/* already holds.
import { JobSearchKvError } from "./errors.js";
import { keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import type { OpportunityStatus } from "./opportunities.js";
import { listOpportunities } from "./opportunities.js";
import { readRecord, writeRecord } from "./records.js";

export interface FeedEntry {
  h: string; // identityHash
  r: string; // rank key = lastSeenAt (ISO-8601 sorts lexicographically)
  s: OpportunityStatus;
}

export interface FeedIndex {
  schemaVersion: 1;
  rebuiltAt: string;
  entries: readonly FeedEntry[];
}

function isFeedEntry(value: unknown): value is FeedEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FeedEntry).h === "string" &&
    typeof (value as FeedEntry).r === "string" &&
    typeof (value as FeedEntry).s === "string"
  );
}

export async function rebuildFeed(kv: JobSearchKv, now: Date): Promise<FeedIndex> {
  const jobs = await listOpportunities(kv);
  const entries: FeedEntry[] = jobs
    .map((job) => ({ h: job.identityHash, r: job.lastSeenAt, s: job.status }))
    // Newest first; hash tie-break keeps the rebuild deterministic.
    .sort((a, b) => (a.r === b.r ? (a.h < b.h ? -1 : 1) : a.r < b.r ? 1 : -1));
  const index: FeedIndex = { schemaVersion: 1, rebuiltAt: now.toISOString(), entries };
  await writeRecord(kv, NS.feed, keys.feedActive, index);
  return index;
}

export async function readFeed(kv: JobSearchKv): Promise<FeedIndex | null> {
  let stored: Record<string, unknown> | null;
  try {
    stored = await readRecord(kv, NS.feed, keys.feedActive);
  } catch (error) {
    // Envelope-level drift on a DERIVED key is corruption, not version skew —
    // collapse to the one code readFeedOrRebuild repairs from.
    if (error instanceof JobSearchKvError) {
      throw new JobSearchKvError("corrupt_index", "stored feed index is unreadable");
    }
    throw error;
  }
  if (stored === null) {
    return null;
  }
  if (
    typeof stored.rebuiltAt !== "string" ||
    !Array.isArray(stored.entries) ||
    !stored.entries.every(isFeedEntry)
  ) {
    throw new JobSearchKvError("corrupt_index", "stored feed index has an invalid shape");
  }
  return stored as unknown as FeedIndex;
}

export async function readFeedOrRebuild(kv: JobSearchKv, now: Date): Promise<FeedIndex> {
  let feed: FeedIndex | null;
  try {
    feed = await readFeed(kv);
  } catch (error) {
    if (error instanceof JobSearchKvError && error.code === "corrupt_index") {
      return rebuildFeed(kv, now);
    }
    throw error;
  }
  return feed ?? rebuildFeed(kv, now);
}
