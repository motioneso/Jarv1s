import { describe, it, expect } from "vitest";
import { registerCommitmentsRoutes } from "@moss/commitments/routes";

describe("registerCommitmentsRoutes", () => {
  it("exports registration function", () => {
    expect(typeof registerCommitmentsRoutes).toBe("function");
  });
});
