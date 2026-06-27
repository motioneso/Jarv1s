import { describe, expect, it } from "vitest";

import { calendarModuleManifest } from "@jarv1s/calendar";

describe("calendar.listVisibleEvents manifest", () => {
  it("inputSchema includes optional startsAfter, startsBefore, limit", () => {
    const tool = calendarModuleManifest.assistantTools?.find(
      (t) => t.name === "calendar.listVisibleEvents"
    );
    expect(tool).toBeDefined();
    const props = (tool!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("startsAfter");
    expect(props).toHaveProperty("startsBefore");
    expect(props).toHaveProperty("limit");
  });
});
