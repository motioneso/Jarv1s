import type { ActorScopedJobPayload } from "@moss/jobs";

export interface GoalMemorySyncPayload extends ActorScopedJobPayload {
  readonly goalId: string;
  readonly goalUpdatedAt: string;
  readonly reason: string;
  readonly idempotencyKey?: string;
}

export type GoalMemorySyncReconcilePayload = ActorScopedJobPayload;
