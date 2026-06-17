import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("chat route MCP wiring", () => {
  it("narrows MCP route dependencies without non-null assertions", () => {
    const routes = readFileSync(
      new URL("../../packages/chat/src/routes.ts", import.meta.url),
      "utf8"
    );

    expect(routes).not.toContain("tokens!");
    expect(routes).not.toContain("gateway!");
  });
});
