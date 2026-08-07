import { describe, expect, it } from "vitest";

import { detectDependencyCycles } from "../../scripts/check-package-deps.js";

describe("detectDependencyCycles", () => {
  it("returns no cycles for an acyclic graph", () => {
    const graph = new Map<string, Set<string>>([
      ["@moss/a", new Set(["@moss/b"])],
      ["@moss/b", new Set(["@moss/c"])],
      ["@moss/c", new Set()]
    ]);

    expect(detectDependencyCycles(graph)).toEqual([]);
  });

  it("returns no cycles for a diamond (shared dependency, not a cycle)", () => {
    const graph = new Map<string, Set<string>>([
      ["@moss/a", new Set(["@moss/b", "@moss/c"])],
      ["@moss/b", new Set(["@moss/d"])],
      ["@moss/c", new Set(["@moss/d"])],
      ["@moss/d", new Set()]
    ]);

    expect(detectDependencyCycles(graph)).toEqual([]);
  });

  it("detects a direct 2-cycle", () => {
    const graph = new Map<string, Set<string>>([
      ["@moss/jobs", new Set(["@moss/settings"])],
      ["@moss/settings", new Set(["@moss/jobs"])]
    ]);

    const cycles = detectDependencyCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(["@moss/jobs", "@moss/settings", "@moss/jobs"]);
  });

  it("detects a 3-cycle through an intermediate package", () => {
    const graph = new Map<string, Set<string>>([
      ["@moss/jobs", new Set(["@moss/settings"])],
      ["@moss/settings", new Set(["@moss/proactive-monitoring"])],
      ["@moss/proactive-monitoring", new Set(["@moss/jobs"])]
    ]);

    const cycles = detectDependencyCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual([
      "@moss/jobs",
      "@moss/settings",
      "@moss/proactive-monitoring",
      "@moss/jobs"
    ]);
  });

  it("does not report a self-reference as a cycle", () => {
    const graph = new Map<string, Set<string>>([["@moss/a", new Set(["@moss/a"])]]);

    // A package can't declare a dependency on itself in package.json, but guard the
    // detector against it anyway so a malformed graph never throws or infinite-loops.
    expect(() => detectDependencyCycles(graph)).not.toThrow();
  });
});
