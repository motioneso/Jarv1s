import type { ActorScopedJobPayload } from "@jarv1s/jobs";

export interface GoalMemorySyncPayload extends ActorScopedJobPayload {
  readonly goalId: string;
  readonly goalUpdatedAt: string;
  readonly reason: string;
  readonly idempotencyKey?: string;
}

export type GoalMemorySyncReconcilePayload = ActorScopedJobPayload;
