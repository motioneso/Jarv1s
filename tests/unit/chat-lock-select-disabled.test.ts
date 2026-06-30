import { describe, expect, it } from "vitest";

// Regression for: select disabled when models=0 traps stuck pin (user can't clear).
// The invariant: busy || (modelsLen === 0 && !value)
// - If a pin is set (value !== ""), keep enabled so user can escape to "Unlocked".
// - Only disable when modelsLen===0 AND no pin (nothing meaningful to select).
const selectDisabled = (busy: boolean, modelsLen: number, value: string): boolean =>
  busy || (modelsLen === 0 && !value);

describe("ChatLockGroup select disabled predicate", () => {
  it("stays enabled when models=0 but a pin is set (escape hatch to Unlocked)", () => {
    expect(selectDisabled(false, 0, "model-abc-id")).toBe(false);
  });

  it("disables when models=0 and no pin (nothing meaningful to do)", () => {
    expect(selectDisabled(false, 0, "")).toBe(true);
  });

  it("disables while loading regardless of models or pin state", () => {
    expect(selectDisabled(true, 0, "model-abc-id")).toBe(true);
    expect(selectDisabled(true, 3, "")).toBe(true);
  });

  it("enabled in the normal case (models present, not busy)", () => {
    expect(selectDisabled(false, 3, "")).toBe(false);
    expect(selectDisabled(false, 3, "model-abc-id")).toBe(false);
  });
});
