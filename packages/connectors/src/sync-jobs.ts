import type { ActorScopedJobPayload, QueueDefinition } from "@jarv1s/jobs";

export const GOOGLE_SYNC_QUEUE = "connectors.google-sync";

export const GOOGLE_SYNC_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: GOOGLE_SYNC_QUEUE,
    options: {
      // exclusive: at most one job per (queue, singletonKey) across created+active.
      // The route sets singletonKey to the actor id so a manual sync racing
      // sync-on-connect collapses to one job (spec §error handling; briefings precedent).
      policy: "exclusive",
      retryLimit: 1,
      deleteAfterSeconds: 300,
      retentionSeconds: 600
    }
  }
];

export interface GoogleSyncPayload extends ActorScopedJobPayload {
  readonly kind: "google-sync";
  readonly idempotencyKey?: string;
}

export interface GoogleSyncResult {
  readonly calendarUpserted: number;
  readonly emailUpserted: number;
  /** Count of messages that failed to fetch/parse/upsert (metadata only; no detail). */
  readonly emailFailures?: number;
  /** Count of LLM escalations to a higher tier (cost/telemetry; metadata only). */
  readonly escalations?: number;
  readonly errors: string[];
  readonly truncated?: boolean;
}
