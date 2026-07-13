import { describe, expect, it } from "vitest";

import { isOutsideTarget } from "../../apps/web/src/shared/use-dismissable-menu.js";

// No jsdom in this repo's Vitest config (node environment only) — the hook's
// document-listener wiring can't be exercised via a real DOM event dispatch
// here, so only the pure isOutsideTarget predicate is unit-tested. The 5
// converted call sites are the real regression surface and are covered by
// manual dev QA per the e2e-dev-uat-for-ui-features convention.
describe("isOutsideTarget", () => {
  it("returns true when the container ref is null", () => {
    expect(isOutsideTarget(null, {} as EventTarget)).toBe(true);
  });

  it("returns true when the target has no nodeType (not a Node)", () => {
    const container = { contains: () => true } as unknown as Element;
    expect(isOutsideTarget(container, {} as EventTarget)).toBe(true);
  });

  it("returns false when the target is contained within the container", () => {
    const node = { nodeType: 1 } as unknown as Node;
    const container = { contains: (t: Node) => t === node } as unknown as Element;
    expect(isOutsideTarget(container, node)).toBe(false);
  });

  it("returns true when the target is a Node not contained within the container", () => {
    const node = { nodeType: 1 } as unknown as Node;
    const container = { contains: () => false } as unknown as Element;
    expect(isOutsideTarget(container, node)).toBe(true);
  });
});
