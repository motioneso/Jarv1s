import { describe, expect, it, vi } from "vitest";

import { createModuleOnboardingSeedResolver } from "../../packages/chat/src/module-onboarding-seed.js";

describe("module onboarding seed resolution", () => {
  it("accepts a manifest with guidance but no optional state tool", async () => {
    const runReadToolForActor = vi.fn();
    const resolve = createModuleOnboardingSeedResolver({
      resolveActiveModules: async () =>
        [
          {
            id: "job-search",
            assistantOnboarding: { guidance: "Start with the resume." },
            assistantTools: []
          }
        ] as never,
      gateway: { runReadToolForActor }
    });

    await expect(resolve("actor-1", "job-search")).resolves.toEqual({
      moduleId: "job-search",
      guidance: "Start with the resume.",
      state: {}
    });
    expect(runReadToolForActor).not.toHaveBeenCalled();
  });
});
