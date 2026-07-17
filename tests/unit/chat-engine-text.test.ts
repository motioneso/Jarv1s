import { expect, it } from "vitest";

import { buildEngineText } from "../../packages/chat/src/live/engine-text.js";

it("never injects page context into ordinary engine text (#1109 — pull-only tool replaces the turn push)", async () => {
  const result = await buildEngineText({ persistence: {} as never }, "u1", "hello");
  expect(result.text).toBe("hello");
  expect(result.text).not.toContain("<page_context>");
});
