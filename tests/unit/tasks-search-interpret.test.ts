import { describe, expect, it } from "vitest";

import {
  normalizeTaskSearchIntent,
  parseTaskSearchIntent
} from "../../packages/tasks/src/search-interpret.js";

describe("task search interpreter", () => {
  const vocabulary = {
    lists: [
      { id: "work", name: "Work" },
      { id: "home", name: "Home" }
    ],
    tagNames: ["Invoices", "Taxes"]
  };

  it("normalizes model JSON and warns on unknown list or tag names", () => {
    const response = normalizeTaskSearchIntent(
      {
        text: "quarterly",
        status: "todo",
        effort: "medium",
        priority: 5,
        listIds: ["home", "missing"],
        tagNames: ["invoices", "unknown"],
        quadrant: "do",
        due: { kind: "today" },
        confidence: "high"
      },
      vocabulary
    );

    expect(response.intent).toEqual({
      text: "quarterly",
      status: "todo",
      effort: "medium",
      priority: 5,
      listIds: ["home"],
      tagNames: ["Invoices"],
      quadrant: "do",
      due: { kind: "today" }
    });
    expect(response.confidence).toBe("high");
    expect(response.warnings).toEqual([
      "Unknown list ignored: missing",
      "Unknown tag ignored: unknown"
    ]);
  });

  it("returns a sanitized error for invalid provider JSON", () => {
    expect(() =>
      parseTaskSearchIntent("not json with secret-looking raw text", vocabulary)
    ).toThrow("Task search interpreter returned invalid JSON");
  });
});
