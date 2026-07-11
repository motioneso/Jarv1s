// external-modules/job-search/src/domain/truth-guard.ts
//
// JS-03 (#932): types for the resume truth guard. A "material claim" is any
// factual assertion an AI critique makes about the user (employer, role,
// dates, skills, credentials, metrics, outcomes). The guard's contract: every
// material claim in an AI revision must carry an exact quote from a stored
// source revision OR reference a recorded user confirmation — anything else
// is returned to the user as a question and never persisted.
// (Task 2 declares the types; verifyClaims + the critique schema land in
// Task 3.)

export type MaterialClaimKind =
  | "employer"
  | "role"
  | "date"
  | "skill"
  | "credential"
  | "metric"
  | "outcome";

export interface MaterialClaim {
  readonly kind: MaterialClaimKind;
  /** The claim as asserted, ≤ 500 chars (CONFIRMATION_TEXT_MAX_CHARS). */
  readonly text: string;
  /** Exact substring of a source revision backing the claim, ≤ 200 chars. */
  readonly quote?: string;
}

/** Provenance attached to a persisted AI revision for each material claim. */
export interface ResumeEvidence {
  readonly claimKind: MaterialClaimKind;
  readonly claimText: string;
  readonly status: "sourced" | "confirmed";
  readonly sourceRevisionId?: string;
  readonly quote?: string;
  readonly confirmationId?: string;
}
