// external-modules/job-search/src/domain/onboarding.ts
//
// JS-02 (#931): onboarding state repo. This record tracks progress flags and
// approved revision ids ONLY. The unknown-key rejection below is a privacy
// guard, not schema pedantry: onboarding flows handle pasted resume text, and
// this is the wall that keeps that text out of the progress record (it
// belongs in job-search.resume revisions, size-gated).
import { JobSearchKvError } from "./errors.js";
import { keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import { readRecord, writeRecord } from "./records.js";

export interface OnboardingState {
  schemaVersion: 1;
  step: string;
  completed: Record<string, boolean>;
  approvedProfileRevisionId?: string;
  approvedResumeRevisionId?: string;
}

const ALLOWED_KEYS = new Set([
  "schemaVersion",
  "step",
  "completed",
  "approvedProfileRevisionId",
  "approvedResumeRevisionId"
]);

export async function saveOnboardingState(kv: JobSearchKv, state: OnboardingState): Promise<void> {
  for (const key of Object.keys(state)) {
    if (!ALLOWED_KEYS.has(key)) {
      // Names the key, never its value — the value could be pasted content.
      throw new JobSearchKvError("invalid_record", `unknown onboarding state key: ${key}`);
    }
  }
  await writeRecord(kv, NS.onboarding, keys.onboardingState, state);
}

export async function getOnboardingState(kv: JobSearchKv): Promise<OnboardingState | null> {
  return (await readRecord(kv, NS.onboarding, keys.onboardingState)) as OnboardingState | null;
}
