import { describe, it, expect } from "vitest";
import {
  commitmentListExecute,
  commitmentGetExecute,
  commitmentAcceptExecute,
  commitmentRejectExecute,
  commitmentSnoozeExecute
} from "@jarv1s/commitments/tools";

describe("commitment tools", () => {
  it("exports all 5 execute functions", () => {
    expect(typeof commitmentListExecute).toBe("function");
    expect(typeof commitmentGetExecute).toBe("function");
    expect(typeof commitmentAcceptExecute).toBe("function");
    expect(typeof commitmentRejectExecute).toBe("function");
    expect(typeof commitmentSnoozeExecute).toBe("function");
  });
});
