import { describe, expect, it } from "vitest";

import { describeHerdrInstallOutcome } from "../../apps/web/src/settings/host-health-summary.js";

describe("describeHerdrInstallOutcome (#1088 F3)", () => {
  it("reports a ready toast for a successful install", () => {
    expect(describeHerdrInstallOutcome({ state: "installed", herdrInstalled: true })).toEqual({
      tone: "ready",
      message: "Herdr installed."
    });
  });

  it("surfaces a failed install instead of going quiet", () => {
    const outcome = describeHerdrInstallOutcome({ state: "failed", herdrInstalled: false });
    expect(outcome.tone).toBe("drift");
    expect(outcome.message).toMatch(/failed/i);
  });

  it("surfaces a timed-out install instead of going quiet", () => {
    const outcome = describeHerdrInstallOutcome({ state: "timeout", herdrInstalled: false });
    expect(outcome.tone).toBe("drift");
    expect(outcome.message).toMatch(/timed out/i);
  });
});
