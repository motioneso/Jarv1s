export type JarvisGoalStatus = "active" | "paused" | "blocked" | "completed" | "archived";

export type JarvisGoalReviewCadence =
  | "none"
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "custom";

export interface JarvisGoal {
  readonly id: string;
  readonly ownerUserId: string;
  readonly title: string;
  readonly desiredOutcome: string;
  readonly status: JarvisGoalStatus;
  readonly priority: 1 | 2 | 3 | 4 | 5;
  readonly reviewCadence: JarvisGoalReviewCadence;
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

export type JarvisGoalEvidenceKind =
  | "context"
  | "task"
  | "status"
  | "progress"
  | "blocker"
  | "decision"
  | "checkpoint"
  | "suggested_action";

export type JarvisGoalSourceKind =
  | "goal"
  | "task"
  | "note"
  | "email"
  | "calendar"
  | "chat"
  | "memory"
  | "manual";

export interface JarvisGoalEvidence {
  readonly id: string;
  readonly ownerUserId: string;
  readonly goalId: string;
  readonly evidenceKind: JarvisGoalEvidenceKind;
  readonly sourceKind: JarvisGoalSourceKind;
  readonly sourceRef: string | null;
  readonly sourceLabel: string;
  readonly summary: string;
  readonly occurredAt: string | null;
  readonly createdAt: string;
}

export interface CreateJarvisGoalRequest {
  readonly title: string;
  readonly desiredOutcome: string;
  readonly priority?: 1 | 2 | 3 | 4 | 5;
  readonly reviewCadence?: JarvisGoalReviewCadence;
  readonly nextReviewAt?: string | null;
  readonly targetAt?: string | null;
}

export interface PatchJarvisGoalRequest {
  readonly title?: string;
  readonly desiredOutcome?: string;
  readonly status?: JarvisGoalStatus;
  readonly priority?: 1 | 2 | 3 | 4 | 5;
  readonly reviewCadence?: JarvisGoalReviewCadence;
  readonly nextReviewAt?: string | null;
  readonly targetAt?: string | null;
  readonly lastProgressSummary?: string | null;
  readonly lastProgressAt?: string | null;
  readonly blockerSummary?: string | null;
  readonly nextSuggestedAction?: string | null;
}

export interface CreateJarvisGoalEvidenceRequest {
  readonly evidenceKind: JarvisGoalEvidenceKind;
  readonly sourceKind: JarvisGoalSourceKind;
  readonly sourceRef?: string | null;
  readonly sourceLabel: string;
  readonly summary: string;
  readonly occurredAt?: string | null;
}
