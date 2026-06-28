import type { PgBoss } from "pg-boss";
import { sendJob, assertMetadataOnlyPayload } from "@jarv1s/jobs";
import { COMMITMENT_EXTRACTION_QUEUE } from "./manifest.js";
import type { CommitmentSourceKind } from "./types.js";

export interface CommitmentExtractionJobPayload {
  readonly actorUserId: string;
  readonly sourceKind: CommitmentSourceKind;
  readonly idempotencyKey: string;
}

export async function enqueueCommitmentExtraction(
  boss: PgBoss,
  actorUserId: string,
  sourceKind: CommitmentSourceKind,
  idempotencyKey: string
): Promise<void> {
  const payload: CommitmentExtractionJobPayload = {
    actorUserId,
    sourceKind,
    idempotencyKey
  };
  assertMetadataOnlyPayload(payload);
  await sendJob(boss, COMMITMENT_EXTRACTION_QUEUE, payload, { singletonKey: idempotencyKey });
}
