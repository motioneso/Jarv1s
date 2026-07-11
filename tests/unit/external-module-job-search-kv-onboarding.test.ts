// tests/unit/external-module-job-search-kv-onboarding.test.ts
//
// JS-02 (#931) Task 3: onboarding state repo. The onboarding record tracks
// progress flags and approved revision ids ONLY — the unknown-key rejection
// is a privacy guard so resume/profile text can never sneak into this record.
import { describe, expect, it } from "vitest";

import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import {
  getOnboardingState,
  saveOnboardingState
} from "../../external-modules/job-search/src/domain/onboarding.js";
import type { OnboardingState } from "../../external-modules/job-search/src/domain/onboarding.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

describe("onboarding state repo", () => {
  it("round-trips the full state shape", async () => {
    const kv = createMemoryKv();
    const state: OnboardingState = {
      schemaVersion: 1,
      step: "resume-review",
      completed: { "paste-resume": true, "confirm-profile": false },
      approvedProfileRevisionId: "p1",
      approvedResumeRevisionId: "0"
    };
    await saveOnboardingState(kv, state);
    expect(await getOnboardingState(kv)).toEqual(state);
  });

  it("returns null before any state is saved", async () => {
    const kv = createMemoryKv();
    expect(await getOnboardingState(kv)).toBeNull();
  });

  it("rejects unknown top-level keys (no resume text can sneak in)", async () => {
    const kv = createMemoryKv();
    const poisoned = {
      schemaVersion: 1,
      step: "paste-resume",
      completed: {},
      resumeText: "My whole resume..."
    } as unknown as OnboardingState;
    const error = await saveOnboardingState(kv, poisoned).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(JobSearchKvError);
    expect((error as JobSearchKvError).code).toBe("invalid_record");
    // Nothing was written — the guard fires before any KV set.
    expect(await getOnboardingState(kv)).toBeNull();
  });
});
