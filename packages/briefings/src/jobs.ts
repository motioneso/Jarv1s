import type { Job, PgBoss, WorkOptions } from "pg-boss";

import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";
import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import {
  registerDataContextWorker,
  type ActorScopedJobPayload,
  type QueueDefinition
} from "@jarv1s/jobs";
import type { RetrievedChunk } from "@jarv1s/memory";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import type { BriefingRunKind } from "@jarv1s/shared";

import type { ComposeDeps } from "./compose.js";
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
  /**
   * Synthesis dependencies forwarded to `generateRun`. When omitted, a metadata-only
   * `composeDeps` is built from `moduleManifests` so the worker still gathers sections
   * and takes the deterministic degraded fallback (no provider configured → no_model).
   * A8 injects the full AI/cipher/memory/notification deps from the module registry.
   */
  readonly composeDeps?: ComposeDeps;
  readonly repository?: BriefingsRepository;
  readonly workOptions?: WorkOptions;
  readonly onResult?: (job: Job<BriefingRunPayload>, result: BriefingRunResult) => void;
}

export const BRIEFINGS_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: BRIEFINGS_RUN_QUEUE,
    options: {
      // `exclusive`: at most one job per (queue, singletonKey) across all
      // non-terminal states (created OR active). This is what makes a
      // client-supplied idempotency key actually dedupe a run-now submit (#150) —
      // a double-click / retry while the first run is still queued or running is
      // collapsed to a single job. The route namespaces the singletonKey by
      // definition id (and uses a unique key for keyless runs so they never
      // falsely collide). Standard policy stores singletonKey but never dedupes.
      policy: "exclusive",
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

/**
 * A vault retriever that returns nothing. Used as the default when no `composeDeps`
 * is injected (A8 injects the registry-built `MemoryRetriever`). Keeping the default
 * inert avoids pulling embedding-model init into the worker before A8 wires the real
 * retriever — compose just records an `empty` vault gap, which is correct here.
 */
const noopMemoryRetriever = {
  async retrieve(_scopedDb: DataContextDb, _query: string): Promise<RetrievedChunk[]> {
    return [];
  },
  async retrieveRecent(_scopedDb: DataContextDb): Promise<RetrievedChunk[]> {
    return [];
  }
} as ComposeDeps["memoryRetriever"];

function defaultComposeDeps(moduleManifests: readonly JarvisModuleManifest[]): ComposeDeps {
  return {
    moduleManifests,
    aiRepository: new AiRepository(),
    cipher: createAiSecretCipher(),
    memoryRetriever: noopMemoryRetriever
  };
}

export async function registerBriefingsJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner,
  options: RegisterBriefingsJobWorkersOptions
): Promise<string[]> {
  const repository = options.repository ?? new BriefingsRepository();
  const composeDeps = options.composeDeps ?? defaultComposeDeps(options.moduleManifests);
  const workId = await registerDataContextWorker<BriefingRunPayload, BriefingRunResult>(
    boss,
    BRIEFINGS_RUN_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      if (!isBriefingRunPayloadMetadataOnly(job.data as unknown as Record<string, unknown>)) {
        throw new Error(`Briefing job ${job.id} contains non-metadata payload fields`);
      }

      const outcome = await repository.generateRun(scopedDb, job.data.definitionId, {
        moduleManifests: options.moduleManifests,
        runKind: job.data.runKind,
        runId: job.data.briefingRunId,
        jobId: job.id,
        composeDeps
      });
      const result = {
        definitionId: job.data.definitionId,
        runId: job.data.briefingRunId,
        status: outcome?.run.status ?? null,
        created: outcome?.created ?? false
      };

      options.onResult?.(job, result);

      return result;
    },
    options.workOptions
  );

  return [workId];
}
