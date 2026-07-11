// external-modules/job-search/src/worker/handlers/flow.ts
//
// JS-03 (#932) Task 4: the onboarding flow engine — the ONLY writer of
// OnboardingState in this slice. `step` is stored for display but always
// recomputed as the first incomplete checkpoint at save time, so backward
// movement (re-saving drafts) never deletes completed flags or approved
// pointers (spec: backward movement without deleting approved history).
import type { JobSearchKv, OnboardingState } from "../../domain/index.js";
import { getOnboardingState, saveOnboardingState } from "../../domain/index.js";

// The six spec checkpoints, in onboarding order (spec §onboarding flow).
export const STEP_ORDER = [
  "resume_intake",
  "resume_critique",
  "resume_approval",
  "profile",
  "sources_schedule",
  "review_enable"
] as const;

export type OnboardingStep = (typeof STEP_ORDER)[number];

/** First incomplete checkpoint, or "done" once all six are complete. */
export function deriveStep(completed: Record<string, boolean>): string {
  for (const step of STEP_ORDER) {
    if (completed[step] !== true) {
      return step;
    }
  }
  return "done";
}

export interface OnboardingPatch {
  readonly complete?: readonly string[];
  readonly approvedResumeRevisionId?: string;
  readonly approvedProfileRevisionId?: string;
}

/**
 * Load-modify-save with monotonic flag merging: patches only ever set flags
 * true; nothing is unset and approved pointers persist once written. The
 * loaded record is spread as-is so a poisoned stored record (unknown keys)
 * still hits the JS-02 `saveOnboardingState` privacy guard on the way back
 * out — the write path fails closed instead of laundering the extra key.
 */
export async function updateOnboarding(
  kv: JobSearchKv,
  patch: OnboardingPatch
): Promise<OnboardingState> {
  const loaded = await getOnboardingState(kv);
  const base: OnboardingState = loaded ?? {
    schemaVersion: 1,
    step: STEP_ORDER[0],
    completed: {}
  };
  const completed = { ...base.completed };
  for (const step of patch.complete ?? []) {
    completed[step] = true;
  }
  const next: OnboardingState = { ...base, completed, step: deriveStep(completed) };
  if (patch.approvedResumeRevisionId !== undefined) {
    next.approvedResumeRevisionId = patch.approvedResumeRevisionId;
  }
  if (patch.approvedProfileRevisionId !== undefined) {
    next.approvedProfileRevisionId = patch.approvedProfileRevisionId;
  }
  await saveOnboardingState(kv, next);
  return next;
}
