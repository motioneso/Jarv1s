import { describe, expect, it } from "vitest";

import { healthSummary } from "../../apps/web/src/settings/host-health-summary.js";

const check = (status: "pass" | "warn" | "fail") => ({
  id: status,
  label: status,
  status,
  detail: ""
});

describe("healthSummary", () => {
  it("is Healthy when every check passes", () => {
    expect(healthSummary([check("pass"), check("pass")]).label).toBe("Healthy");
  });

  it("is Needs attention when a warning exists and nothing fails", () => {
    expect(healthSummary([check("pass"), check("warn")]).label).toBe("Needs attention");
  });

  it("is Action required when any check fails, even alongside warnings", () => {
    expect(healthSummary([check("warn"), check("fail")]).label).toBe("Action required");
  });
});
