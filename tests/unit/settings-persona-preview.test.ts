import { describe, expect, it } from "vitest";

import { personaSeedText } from "../../apps/web/src/settings/settings-persona-preview.js";

describe("personaSeedText", () => {
  it("turns dials into editable starter persona text", () => {
    expect(
      personaSeedText({
        tone: "Crisp",
        directness: "Direct",
        humor: "Dry",
        recovery: "Firm"
      })
    ).toContain("Keep responses crisp");
  });
});
