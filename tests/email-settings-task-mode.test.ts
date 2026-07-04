import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { EMAIL_TASK_CREATION_MODES } from "@jarv1s/shared";

it("keeps every persisted email task creation mode reachable from Email settings", () => {
  const source = readFileSync("packages/email/src/settings/index.tsx", "utf8");

  for (const mode of EMAIL_TASK_CREATION_MODES) {
    expect(source).toContain(`value: "${mode}"`);
    expect(source).toContain(`<option key={option.value} value={option.value}>`);
  }
  expect(source).toContain("/api/email/task-creation-mode");
});
