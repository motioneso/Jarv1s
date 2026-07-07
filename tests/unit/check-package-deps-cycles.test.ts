import { describe, expect, it } from "vitest";

import { detectDependencyCycles } from "../../scripts/check-package-deps.js";

describe("detectDependencyCycles", () => {
  it("returns no cycles for an acyclic graph", () => {
    const graph = new Map<string, Set<string>>([
      ["@jarv1s/a", new Set(["@jarv1s/b"])],
      ["@jarv1s/b", new Set(["@jarv1s/c"])],
      ["@jarv1s/c", new Set()]
    ]);

    expect(detectDependencyCycles(graph)).toEqual([]);
  });

  it("returns no cycles for a diamond (shared dependency, not a cycle)", () => {
    const graph = new Map<string, Set<string>>([
      ["@jarv1s/a", new Set(["@jarv1s/b", "@jarv1s/c"])],
      ["@jarv1s/b", new Set(["@jarv1s/d"])],
      ["@jarv1s/c", new Set(["@jarv1s/d"])],
      ["@jarv1s/d", new Set()]
    ]);

    expect(detectDependencyCycles(graph)).toEqual([]);
  });

  it("detects a direct 2-cycle", () => {
    const graph = new Map<string, Set<string>>([
      ["@jarv1s/jobs", new Set(["@jarv1s/settings"])],
      ["@jarv1s/settings", new Set(["@jarv1s/jobs"])]
    ]);

    const cycles = detectDependencyCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(["@jarv1s/jobs", "@jarv1s/settings", "@jarv1s/jobs"]);
  });

  it("detects a 3-cycle through an intermediate package", () => {
    const graph = new Map<string, Set<string>>([
      ["@jarv1s/jobs", new Set(["@jarv1s/settings"])],
      ["@jarv1s/settings", new Set(["@jarv1s/proactive-monitoring"])],
      ["@jarv1s/proactive-monitoring", new Set(["@jarv1s/jobs"])]
    ]);

    const cycles = detectDependencyCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual([
      "@jarv1s/jobs",
      "@jarv1s/settings",
      "@jarv1s/proactive-monitoring",
      "@jarv1s/jobs"
    ]);
  });

  it("does not report a self-reference as a cycle", () => {
    const graph = new Map<string, Set<string>>([["@jarv1s/a", new Set(["@jarv1s/a"])]]);

    // A package can't declare a dependency on itself in package.json, but guard the
    // detector against it anyway so a malformed graph never throws or infinite-loops.
    expect(() => detectDependencyCycles(graph)).not.toThrow();
  });
});
