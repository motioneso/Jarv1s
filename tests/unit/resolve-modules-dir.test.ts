/**
 * resolveModulesDir (#996, #860): shared fallback chain replacing the 4+ independent
 * `env.JARVIS_MODULES_DIR ?? null` reads the JARVIS_ENABLE_EXTERNAL_MODULES removal left
 * behind. Explicit env override wins; otherwise walk up from this module's own directory
 * for the pnpm-workspace.yaml marker (never anchor on a fixed relative offset — esbuild
 * bundling collapses import.meta.url, the known bundled-path-resolution trap).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveModulesDir } from "../../packages/module-registry/src/resolve-modules-dir.js";

describe("resolveModulesDir (#996, #860)", () => {
  it("honors an explicit JARVIS_MODULES_DIR override verbatim", () => {
    expect(resolveModulesDir({ JARVIS_MODULES_DIR: "/srv/modules" } as NodeJS.ProcessEnv)).toBe(
      "/srv/modules"
    );
  });

  it("resolves to <repoRoot>/data/modules via the pnpm-workspace.yaml marker walk when unset", () => {
    const dir = resolveModulesDir({} as NodeJS.ProcessEnv);
    expect(dir.endsWith(path.join("data", "modules"))).toBe(true);
    const repoRoot = dir.slice(0, dir.length - path.join("data", "modules").length - 1);
    expect(existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))).toBe(true);
  });
});
