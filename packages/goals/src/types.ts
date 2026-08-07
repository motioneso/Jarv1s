export type MossGoalStatus = "active" | "paused" | "blocked" | "completed" | "archived";

export type MossGoalReviewCadence = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "custom";

export interface MossGoal {
  readonly id: string;
  readonly ownerUserId: string;
  readonly title: string;
  readonly desiredOutcome: string;
  readonly status: MossGoalStatus;
  readonly priority: 1 | 2 | 3 | 4 | 5;
  readonly reviewCadence: MossGoalReviewCadence;
  readonly nextReviewAt: string | null;
  readonly targetAt: string | null;
  readonly lastProgressSummary: string | null;
  readonly lastProgressAt: string | null;
  readonly blockerSummary: string | null;
  readonly nextSuggestedAction: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly archivedAt: string | null;
}

export type MossGoalEvidenceKind =
  | "context"
  | "task"
  | "status"
  | "progress"
  | "blocker"
  | "decision"
  | "checkpoint"
  | "suggested_action";

export type MossGoalSourceKind =
  | "goal"
  | "task"
  | "note"
  | "email"
  | "calendar"
  | "chat"
  | "memory"
  | "manual";

export interface MossGoalEvidence {
  readonly id: string;
  readonly ownerUserId: string;
  readonly goalId: string;
  readonly evidenceKind: MossGoalEvidenceKind;
  readonly sourceKind: MossGoalSourceKind;
  readonly sourceRef: string | null;
  readonly sourceLabel: string;
  readonly summary: string;
  readonly occurredAt: string | null;
  readonly createdAt: string;
}

export interface CreateMossGoalRequest {
  readonly title: string;
  readonly desiredOutcome: string;
  readonly priority?: 1 | 2 | 3 | 4 | 5;
  readonly reviewCadence?: MossGoalReviewCadence;
  readonly nextReviewAt?: string | null;
  readonly targetAt?: string | null;
}

export interface PatchMossGoalRequest {
  readonly title?: string;
  readonly desiredOutcome?: string;
  readonly status?: MossGoalStatus;
  readonly priority?: 1 | 2 | 3 | 4 | 5;
  readonly reviewCadence?: MossGoalReviewCadence;
  readonly nextReviewAt?: string | null;
  readonly targetAt?: string | null;
  readonly lastProgressSummary?: string | null;
  readonly lastProgressAt?: string | null;
  readonly blockerSummary?: string | null;
  readonly nextSuggestedAction?: string | null;
}

export interface CreateMossGoalEvidenceRequest {
  readonly evidenceKind: MossGoalEvidenceKind;
  readonly sourceKind: MossGoalSourceKind;
  readonly sourceRef?: string | null;
  readonly sourceLabel: string;
  readonly summary: string;
  readonly occurredAt?: string | null;
}
