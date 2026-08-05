// The briefing declaration is only useful if it survives manifest validation INTACT.
// Every case here asserts through validateExternalModuleManifest()'s validated output,
// never the raw JSON: the validator reconstructs the manifest from an allow-list, so a
// block that validates but is not re-emitted disappears with ok: true (F1).
import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "../../packages/module-registry/src/node.js";

const baseManifest = {
  schemaVersion: 1,
  id: "job-search",
  name: "Job Search",
  version: "1.0.0",
  publisher: "Jarvis",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" },
  runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 }
};

const briefing = {
  handler: "briefing.contribute",
  sections: ["morning", "evening"],
  toolName: "job-search.briefing"
};

describe("external manifest briefing declaration (#1282)", () => {
  it("survives manifest reconstruction", () => {
    const result = validateExternalModuleManifest({ ...baseManifest, briefing }, "job-search");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Deep-equal, not a truthiness check: this is the assertion that fails when the
    // re-emit line is missing from the reconstruction literal, and nothing else does.
    expect(result.manifest.briefing).toEqual(briefing);
  });

  it("rejects a briefing block on a module with no runtime", () => {
    const { runtime: _runtime, ...noRuntime } = baseManifest;
    const result = validateExternalModuleManifest({ ...noRuntime, briefing }, "job-search");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/runtime is required when briefing/);
  });

  it("rejects an unknown section rather than normalizing it away", () => {
    const result = validateExternalModuleManifest(
      { ...baseManifest, briefing: { ...briefing, sections: ["lunchtime"] } },
      "job-search"
    );

    // Silently dropping the bad entry would leave a module declaring a section it can
    // never be invoked for, with nothing telling its author why.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/briefing\.sections/);
  });
});
