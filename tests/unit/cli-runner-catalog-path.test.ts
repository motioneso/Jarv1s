/**
 * Regression test for the v0.1.0 install blocker (#342): the recipe-catalog lockfile path must
 * resolve correctly regardless of the runtime LAYOUT. `catalog.ts` is consumed BOTH by the
 * cli-runner (tsx, from packages/cli-runner/src) AND bundled into the api's dist/server.js — and
 * `scripts/build-app.ts` collapses `import.meta.url` to the bundle dir. The old fixed
 * `MODULE_DIR/../../..` offset therefore resolved the committed lockfile to `/` inside the bundled
 * api, reading "lockfile missing", which demoted claude/codex to `blocked` at catalog load and made
 * `POST /api/onboarding/provider-install` 400 before the RPC ever reached the cli-runner.
 *
 * The fix walks up to the `pnpm-workspace.yaml` repo-root marker, which is correct from src, a dist
 * bundle, and a test. These assertions fail against the old fixed-offset resolution.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CATALOG_VALIDATION_ISSUES,
  PROVIDER_CATALOG,
  findRepoRoot
} from "../../packages/cli-runner/src/catalog.js";

const REPO_ROOT = process.cwd(); // vitest runs from the repo root

describe("catalog lockfile path resolution (#342 install blocker)", () => {
  it("findRepoRoot walks up to the pnpm-workspace.yaml marker from ANY layout depth", () => {
    // tsx layout (cli-runner runs from src)
    expect(findRepoRoot(path.join(REPO_ROOT, "packages", "cli-runner", "src"))).toBe(REPO_ROOT);
    // bundled-api layout (import.meta.url collapses to the dist dir) — the bug case
    expect(findRepoRoot(path.join(REPO_ROOT, "dist"))).toBe(REPO_ROOT);
    // deep nested
    expect(findRepoRoot(path.join(REPO_ROOT, "a", "b", "c", "d"))).toBe(REPO_ROOT);
  });

  it("the committed lockfiles are reachable from the resolved repo root (both layouts)", () => {
    for (const start of [
      path.join(REPO_ROOT, "packages", "cli-runner", "src"),
      path.join(REPO_ROOT, "dist")
    ]) {
      const root = findRepoRoot(start);
      expect(
        existsSync(path.join(root, "packages/cli-runner/recipes/anthropic/npm-shrinkwrap.json"))
      ).toBe(true);
      expect(
        existsSync(
          path.join(root, "packages/cli-runner/recipes/openai-compatible/npm-shrinkwrap.json")
        )
      ).toBe(true);
    }
  });

  it("claude + codex load as `supported` (NOT demoted to blocked over a missing lockfile)", () => {
    expect(PROVIDER_CATALOG.anthropic.status).toBe("supported");
    expect(PROVIDER_CATALOG["openai-compatible"].status).toBe("supported");
    // No lockfile-related demotion for the MVP providers.
    const lockfileDemotions = CATALOG_VALIDATION_ISSUES.filter(
      (i) => i.provider !== "google" && /lockfile/i.test(i.reason)
    );
    expect(lockfileDemotions).toEqual([]);
  });
});
