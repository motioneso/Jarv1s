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
import { existsSync, readFileSync } from "node:fs";
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

  // install-service.ts reads the SAME committed lockfile at install time (a SECOND read,
  // distinct from the catalog's load-time validation). #357 fixed only catalog.ts, so the
  // bundled api still ENOENT'd at install with the fixed MODULE_DIR/../../.. offset. This
  // collapse is invisible to a runtime test (it only manifests under esbuild bundling), so
  // guard at the source level — like the catalog fix, it must use the marker walk.
  it("install-service resolves the repo root via findRepoRoot, not a fixed offset", () => {
    const src = readFileSync(
      path.join(REPO_ROOT, "packages/cli-runner/src/install-service.ts"),
      "utf8"
    );
    expect(src).toMatch(/findRepoRoot\(/);
    expect(src).not.toMatch(/fileURLToPath\(import\.meta\.url\)\)\s*,\s*"\.\."\s*,\s*"\.\."/);
  });
});

// The cli-runner boot invocation must live ONLY in the never-imported main-entry.ts.
// main.ts is bundled into the api's dist/server.js (the api imports the cli-runner barrel),
// where import.meta.url collapses to the bundle URL == `file://${process.argv[1]}` — so an
// `if (isEntrypoint) main()` guard in main.ts MIS-FIRED and the api booted its own
// CliRunnerServer on the sidecar's socket. A runtime import can't reproduce the collapse
// (vitest's argv[1] never equals the module URL), so assert it at the source level.
describe("cli-runner boot has no importable side effect (#342 sidecar double-run)", () => {
  // Strip block + line comments so the assertions see executable code only (the fix's
  // explanatory comments deliberately mention import.meta.url / isEntrypoint).
  const readCode = (rel: string) =>
    readFileSync(path.join(process.cwd(), rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

  it("main.ts does NOT invoke main() at module scope (no isEntrypoint guard)", () => {
    const code = readCode("packages/cli-runner/src/main.ts");
    expect(code).not.toMatch(/import\.meta\.url/);
    expect(code).not.toMatch(/^\s*main\(\)/m);
    expect(code).not.toMatch(/isEntrypoint/);
  });

  it("main-entry.ts is the sole side-effecting module (calls main())", () => {
    const src = read("packages/cli-runner/src/main-entry.ts");
    expect(src).toMatch(/import\s*\{\s*main\s*\}\s*from\s*"\.\/main\.js"/);
    expect(src).toMatch(/main\(\)\s*\.catch/);
  });

});
