// tests/unit/external-module-job-search-absence.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getBuiltInModuleManifests } from "@jarv1s/module-registry";

// JS-01 (#930): the core image must never compile, copy, or register Job Search.
// These assertions pin the three exclusion seams: docker build context, built-in
// module registry, and the pnpm workspace globs.
const repoFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("job-search stays out of the core image (#930)", () => {
  it(".dockerignore excludes external-modules from the build context", () => {
    const lines = repoFile(".dockerignore")
      .split("\n")
      .map((line) => line.trim());
    expect(lines).toContain("external-modules");
  });

  it("BUILT_IN_MODULES has no job-search registration", () => {
    const ids = getBuiltInModuleManifests().map((manifest) => manifest.id);
    expect(ids).not.toContain("job-search");
    expect(ids.some((id) => id.startsWith("job-search"))).toBe(false);
  });

  it("the pnpm workspace does not include external-modules", () => {
    // Workspace globs are apps/*, packages/*, spikes/* — external-modules/ must stay
    // outside so the core install/build never pulls the package in.
    expect(repoFile("pnpm-workspace.yaml")).not.toContain("external-modules");
  });
});
