import { describe, expect, it } from "vitest";

import {
  nextFocusTrapIndex,
  restorePaletteFocus,
  shouldRunDialogEnter,
  taskChoices
} from "../../apps/web/src/shell/command-palette.js";

describe("command palette helpers", () => {
  it("keeps Enter handling local to the title input during task creation", () => {
    expect(shouldRunDialogEnter("enter-title", true)).toBe(false);
    expect(shouldRunDialogEnter("enter-title", false)).toBe(true);
    expect(shouldRunDialogEnter("root", true)).toBe(true);
  });

  it("wraps focus within the palette dialog", () => {
    expect(nextFocusTrapIndex(0, 1, false)).toBe(0);
    expect(nextFocusTrapIndex(0, 1, true)).toBe(0);
    expect(nextFocusTrapIndex(2, 3, false)).toBe(0);
    expect(nextFocusTrapIndex(0, 3, true)).toBe(2);
    expect(nextFocusTrapIndex(1, 3, false)).toBeNull();
  });

  it("falls back to Personal when there are no task lists", () => {
    expect(taskChoices([])).toEqual([{ id: null, name: "Personal" }]);
  });

  it("restores focus only for still-connected elements", () => {
    let focusCount = 0;
    const connected = {
      isConnected: true,
      focus: () => {
        focusCount += 1;
      }
    } as unknown as HTMLElement;
    const stale = {
      isConnected: false,
      focus: () => {
        throw new Error("should not focus");
      }
    } as unknown as HTMLElement;

    expect(() => restorePaletteFocus(connected)).not.toThrow();
    expect(() => restorePaletteFocus(stale)).not.toThrow();
    expect(() => restorePaletteFocus(null)).not.toThrow();
    expect(focusCount).toBe(1);
  });
});
