import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CALENDAR_AUTOMATION_MODES } from "@jarv1s/shared";

it("keeps every Calendar automation mode reachable from Calendar settings", () => {
  const source = readFileSync("packages/calendar/src/settings/index.tsx", "utf8");

  for (const mode of CALENDAR_AUTOMATION_MODES) {
    expect(source).toContain(`value: "${mode}"`);
  }
  expect(source).toContain("prepTaskMode");
  expect(source).toContain("timeBlockMode");
  expect(source).not.toContain("commitmentMode");
  expect(source).not.toContain("Commitment detection");
});
