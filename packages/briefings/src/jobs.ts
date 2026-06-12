import type { Job, PgBoss, WorkOptions } from "pg-boss";

import type { DataContextRunner } from "@jarv1s/db";
import {
  registerDataContextWorker,
  type ActorScopedJobPayload,
  type QueueDefinition
} from "@jarv1s/jobs";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import type { BriefingRunKind } from "@jarv1s/shared";

import { BRIEFINGS_RUN_QUEUE } from "./manifest.js";
import { BriefingsRepository } from "./repository.js";

export interface BriefingRunPayload extends ActorScopedJobPayload {
  readonly definitionId: string;
  readonly briefingRunId: string;
  readonly runKind: BriefingRunKind;
  readonly idempotencyKey?: string;
}

export interface BriefingRunResult {
  readonly definitionId: string;
  readonly runId: string;
  readonly status: "succeeded" | "blocked" | "failed" | null;
  readonly created: boolean;
}

export interface RegisterBriefingsJobWorkersOptions {
  readonly moduleManifests: readonly JarvisModuleManifest[];
  readonly repository?: BriefingsRepository;
  readonly workOptions?: WorkOptions;
  readonly onResult?: (job: Job<BriefingRunPayload>, result: BriefingRunResult) => void;
}

export const BRIEFINGS_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: BRIEFINGS_RUN_QUEUE,
    options: {
      retryLimit: 0,
      deleteAfterSeconds: 60,
      retentionSeconds: 60
    }
  }
];

export const BRIEFING_RUN_PAYLOAD_KEYS = [
  "actorUserId",
  "definitionId",
  "briefingRunId",
  "runKind",
  "idempotencyKey"
] as const;

export function isBriefingRunPayloadMetadataOnly(payload: Record<string, unknown>): boolean {
  const allowedKeys = new Set<string>(BRIEFING_RUN_PAYLOAD_KEYS);

  return Object.keys(payload).every((key) => allowedKeys.has(key));
}

export async function registerBriefingsJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner,
  options: RegisterBriefingsJobWorkersOptions
): Promise<string[]> {
  const repository = options.repository ?? new BriefingsRepository();
  const workId = await registerDataContextWorker<BriefingRunPayload, BriefingRunResult>(
    boss,
    BRIEFINGS_RUN_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      if (!isBriefingRunPayloadMetadataOnly(job.data as unknown as Record<string, unknown>)) {
        throw new Error(`Briefing job ${job.id} contains non-metadata payload fields`);
      }

      const run = await repository.generateRun(scopedDb, job.data.definitionId, {
        moduleManifests: options.moduleManifests,
        runKind: job.data.runKind,
        runId: job.data.briefingRunId,
        jobId: job.id
      });
      const result = {
        definitionId: job.data.definitionId,
        runId: job.data.briefingRunId,
        status: run?.status ?? null,
        created: run !== undefined
      };

      options.onResult?.(job, result);

      return result;
    },
    options.workOptions
  );

  return [workId];
}
