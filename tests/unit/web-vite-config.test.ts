import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("web development proxy", () => {
  it("forwards API WebSocket upgrades used by the provider terminal", () => {
    const source = readFileSync(new URL("../../apps/web/vite.config.ts", import.meta.url), "utf8");
    const apiProxy = source.match(/"\/api":\s*\{([\s\S]*?)\n\s*\},\n\s*"\/health"/)?.[1];

    expect(apiProxy).toMatch(/\bws:\s*true\b/);
  });
});
