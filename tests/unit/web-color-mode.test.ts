import { afterEach, describe, expect, it } from "vitest";

import { readColorMode } from "../../apps/web/src/theme/color-mode.js";

describe("color mode contract", () => {
  const previousDocument = globalThis.document;

  afterEach(() => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument
    });
  });

  it("reads mode from data-color-mode independently of accent", () => {
    const values = new Map([
      ["data-theme", "sage"],
      ["data-color-mode", "dark"]
    ]);
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { documentElement: { getAttribute: (name: string) => values.get(name) ?? null } }
    });

    expect(readColorMode()).toBe("dark");
  });
});
