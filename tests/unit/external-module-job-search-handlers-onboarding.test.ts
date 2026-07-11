// tests/unit/external-module-job-search-handlers-onboarding.test.ts
//
// JS-03 (#932) Task 4: onboarding flow engine (deriveStep/updateOnboarding).
// Task 5 extends this file with the onboarding.get-state handler suite.
// The flow engine is the only writer of OnboardingState in JS-03; these tests
// pin the six-checkpoint order, forward-only flag merging (backward movement
// never deletes approved history — spec), and that the JS-02 unknown-key
// privacy guard stays on the write path (pasted resume text can never ride
// along in the progress record).
import { describe, expect, it } from "vitest";

import {
  JobSearchKvError,
  NS,
  getOnboardingState,
  keys
} from "../../external-modules/job-search/src/domain/index.js";
import {
  STEP_ORDER,
  deriveStep,
  updateOnboarding
} from "../../external-modules/job-search/src/worker/handlers/flow.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

describe("STEP_ORDER", () => {
  it("is the six spec checkpoints in onboarding order", () => {
    expect(STEP_ORDER).toEqual([
      "resume_intake",
      "resume_critique",
      "resume_approval",
      "profile",
      "sources_schedule",
      "review_enable"
    ]);
  });
});

describe("deriveStep", () => {
  it("returns the first checkpoint when nothing is complete", () => {
    expect(deriveStep({})).toBe("resume_intake");
  });

  it("returns the first incomplete checkpoint", () => {
    expect(deriveStep({ resume_intake: true })).toBe("resume_critique");
    expect(deriveStep({ resume_intake: true, resume_critique: true, resume_approval: true })).toBe(
      "profile"
    );
  });

  it("skips flags recorded false and unknown flags alike", () => {
    // false is not complete; unknown keys must not shift the derived step.
    expect(deriveStep({ resume_intake: false, bogus_step: true })).toBe("resume_intake");
  });

  it("returns done once all six checkpoints are complete", () => {
    const completed = Object.fromEntries(STEP_ORDER.map((step) => [step, true]));
    expect(deriveStep(completed)).toBe("done");
  });
});

describe("updateOnboarding", () => {
  it("creates the initial record on first call and stores the derived step", async () => {
    const kv = createMemoryKv();
    const state = await updateOnboarding(kv, { complete: ["resume_intake"] });
    expect(state).toEqual({
      schemaVersion: 1,
      step: "resume_critique",
      completed: { resume_intake: true }
    });
    // Round-trips through the JS-02 repo — the returned state IS the stored state.
    expect(await getOnboardingState(kv)).toEqual(state);
  });

  it("an empty patch on a fresh kv persists the initial state", async () => {
    const kv = createMemoryKv();
    const state = await updateOnboarding(kv, {});
    expect(state).toEqual({ schemaVersion: 1, step: "resume_intake", completed: {} });
    expect(await getOnboardingState(kv)).toEqual(state);
  });

  it("merges complete flags monotonically — later patches never unset earlier ones", async () => {
    const kv = createMemoryKv();
    await updateOnboarding(kv, { complete: ["resume_intake", "resume_critique"] });
    const state = await updateOnboarding(kv, { complete: ["resume_approval"] });
    expect(state.completed).toEqual({
      resume_intake: true,
      resume_critique: true,
      resume_approval: true
    });
    expect(state.step).toBe("profile");
    // An empty patch is a pure re-derive — nothing lost.
    const unchanged = await updateOnboarding(kv, {});
    expect(unchanged).toEqual(state);
  });

  it("persists approved revision ids and keeps them across later patches", async () => {
    const kv = createMemoryKv();
    await updateOnboarding(kv, {
      complete: ["resume_intake"],
      approvedResumeRevisionId: "0"
    });
    const state = await updateOnboarding(kv, {
      complete: ["profile"],
      approvedProfileRevisionId: "p1"
    });
    expect(state.approvedResumeRevisionId).toBe("0");
    expect(state.approvedProfileRevisionId).toBe("p1");
    expect(await getOnboardingState(kv)).toEqual(state);
  });

  it("fails closed on a poisoned stored record — the JS-02 unknown-key guard is the write path", async () => {
    const kv = createMemoryKv();
    // Adversarial seed: bypass the repo and plant an extra key next to valid state.
    await kv.set(NS.onboarding, keys.onboardingState, {
      schemaVersion: 1,
      step: "resume_intake",
      completed: {},
      resumeText: "My whole resume..."
    });
    const error = await updateOnboarding(kv, { complete: ["resume_intake"] }).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(JobSearchKvError);
    expect((error as JobSearchKvError).code).toBe("invalid_record");
  });
});
