import { describe, expect, it } from "vitest";

import { isRootWorkspaceConfigured } from "../../packages/ai/src/adapters/root-workspace.js";

describe("isRootWorkspaceConfigured (#993 — shared Root-workspace predicate)", () => {
  it("is true when JARVIS_HERDR_ROOT_TAB is set", () => {
    expect(isRootWorkspaceConfigured({ JARVIS_HERDR_ROOT_TAB: "jarvis-root" })).toBe(true);
  });

  it("is true when JARVIS_HERDR_ROOT_PANE is set", () => {
    expect(isRootWorkspaceConfigured({ JARVIS_HERDR_ROOT_PANE: "w1:p1" })).toBe(true);
  });

  it("is true when the runtime's HERDR_PANE_ID is set", () => {
    expect(isRootWorkspaceConfigured({ HERDR_PANE_ID: "p_1" })).toBe(true);
  });

  it("is false when none are set", () => {
    expect(isRootWorkspaceConfigured({})).toBe(false);
  });

  it("treats whitespace-only values as unset", () => {
    expect(
      isRootWorkspaceConfigured({
        JARVIS_HERDR_ROOT_TAB: "  ",
        JARVIS_HERDR_ROOT_PANE: "",
        HERDR_PANE_ID: "\t"
      })
    ).toBe(false);
  });
});
