import type { PgBoss } from "pg-boss";
import { assertMetadataOnlyPayload, sendJob } from "@jarv1s/jobs";
import type { PersonSourceKind } from "./types.js";

export const PERSON_INDEX_QUEUE = "person-index";
export const SYNC_PERSON_MEMORY_QUEUE = "sync-person-memory";

const MAX_BATCH_SIZE = 50;
const COOLDOWN_MS = 15 * 60 * 1000;

export interface PersonIndexPayload {
  readonly actorUserId: string;
  readonly source: PersonSourceKind;
  readonly sourceRefHash: string;
  readonly sourceVersion?: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface SyncPersonMemoryPayload {
  readonly actorUserId: string;
  readonly personId: string;
  readonly personUpdatedAt: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export function assertMetadataOnlyPersonPayload(data: unknown): void {
  assertMetadataOnlyPayload(data);
}

export interface EnqueuePersonIndexParams {
  readonly actorUserId: string;
  readonly source: PersonSourceKind;
  readonly sourceRefHash: string;
  readonly sourceVersion?: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export async function enqueuePersonIndex(
  boss: PgBoss,
  params: EnqueuePersonIndexParams
): Promise<void> {
  const payload: PersonIndexPayload = {
    actorUserId: params.actorUserId,
    source: params.source,
    sourceRefHash: params.sourceRefHash,
    sourceVersion: params.sourceVersion,
    reason: params.reason,
    idempotencyKey: params.idempotencyKey
  };

  assertMetadataOnlyPersonPayload(payload);
  await sendJob(boss, PERSON_INDEX_QUEUE, payload, {
    singletonKey: params.idempotencyKey,
    startAfter: COOLDOWN_MS / 1000
  });
}

export async function enqueuePersonIndexBatch(
  boss: PgBoss,
  items: EnqueuePersonIndexParams[]
): Promise<void> {
  const batch = items.slice(0, MAX_BATCH_SIZE);
  for (const item of batch) {
    await enqueuePersonIndex(boss, item);
  }
}

export async function enqueueSyncPersonMemory(
  boss: PgBoss,
  params: SyncPersonMemoryPayload
): Promise<void> {
  assertMetadataOnlyPersonPayload(params);
  await sendJob(boss, SYNC_PERSON_MEMORY_QUEUE, params, {
    singletonKey: params.idempotencyKey
  });
}
