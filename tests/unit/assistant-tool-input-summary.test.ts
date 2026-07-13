import { describe, expect, it } from "vitest";

import { summarizeAssistantToolInput } from "@jarv1s/ai";

describe("summarizeAssistantToolInput", () => {
  it("caps model-controlled key names and count without persisting values", () => {
    const secret = "raw-secret-value";
    const input = Object.fromEntries([
      ["x".repeat(80), secret],
      ...Array.from({ length: 40 }, (_, index) => [`key-${String(index).padStart(2, "0")}`, secret])
    ]);

    const summary = summarizeAssistantToolInput(input);

    expect(summary.inputKeys).toHaveLength(32);
    expect(summary.inputKeys.every((key) => key.length <= 64)).toBe(true);
    expect(summary.inputKeyCount).toBe(41);
    expect(summary.truncated).toBe(true);
    expect(JSON.stringify(summary)).not.toContain(secret);
  });
});
