import { describe, it, expect } from "vitest";
import { registerCommitmentsRoutes } from "@jarv1s/commitments/routes";

describe("registerCommitmentsRoutes", () => {
  it("exports registration function", () => {
    expect(typeof registerCommitmentsRoutes).toBe("function");
  });
});
