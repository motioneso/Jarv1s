import { describe, expect, it } from "vitest";

import { isOutsideTarget } from "../../apps/web/src/shared/use-dismissable-menu.js";

// vitest.config.ts's global default is still the node environment (no DOM) — a DOM environment
// is available on a per-file opt-in basis (see the header of tests/unit/job-search-use-profiles.
// test.tsx for how a suite requests one), but this file doesn't opt in, so the hook's
// document-listener wiring still can't be exercised via a real DOM event dispatch here; only
// the pure isOutsideTarget predicate is unit-tested. The 5 converted call sites are the real
// regression surface and are covered by manual dev QA per the e2e-dev-uat-for-ui-features
// convention. (Deliberately not spelling out that opt-in mechanism's literal syntax here: Vitest's
// docblock scanner matches it anywhere in a file's text, not just as a real directive, so writing
// it out in a comment silently flips this file's environment too.)
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
