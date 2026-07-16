/**
 * Regression test for #1088 F1 (Fable sweep on PR #1065): `herdr-install-port.ts`
 * computed the repo root via a fixed `MODULE_DIR/../../..` offset from
 * `import.meta.url`. That file is bundled into the prod api by esbuild
 * (scripts/build-app.ts, entry apps/api/src/server.ts), which COLLAPSES
 * `import.meta.url` to the bundle's own dir (`dist/server.js`) — the #357
 * bundled-path-resolution trap, same class already fixed once for
 * packages/cli-runner/src/catalog.ts (see tests/unit/cli-runner-catalog-path.test.ts)
 * and packages/module-registry/src/resolve-modules-dir.ts. The fixed offset resolved
 * `INSTALL_SCRIPT_PATH` outside the repo entirely under the bundled layout, so the
 * install route failed on every real (non-tsx) invocation.
 *
 * `scripts/build-app.ts` always resolves its `dist/` outfile as `resolve(root, "dist/…")`
 * from the repo root — so simulating `findRepoRoot` starting at `<repoRoot>/dist` is an
 * exact stand-in for what the function receives at runtime inside the bundled api,
 * not an approximation (the same technique the catalog.ts precedent test uses). A real
 * `pnpm build:api` was additionally run manually against this fix (esbuild + the
 * build's own `node --check` parse-check both passed) — that step isn't committed here
 * because build-app.ts is deliberately excluded from `verify:foundation` (it's slow and
 * requires the full pruned dependency graph); this test is the fast, CI-safe proof that
 * exercises the identical resolution the bundle triggers.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findRepoRoot } from "../../apps/api/src/herdr-install-port.js";

const REPO_ROOT = process.cwd(); // vitest runs from the repo root

describe("herdr-install-port repo-root resolution (#1088 F1)", () => {
  it("walks up to the pnpm-workspace.yaml marker from ANY layout depth", () => {
    // tsx/src layout (api runs from apps/api/src in dev)
    expect(findRepoRoot(path.join(REPO_ROOT, "apps", "api", "src"))).toBe(REPO_ROOT);
    // bundled-api layout (import.meta.url collapses to the dist dir) — the bug case
    expect(findRepoRoot(path.join(REPO_ROOT, "dist"))).toBe(REPO_ROOT);
    // deep nested, for good measure
    expect(findRepoRoot(path.join(REPO_ROOT, "a", "b", "c", "d"))).toBe(REPO_ROOT);
  });

  it("the install script is reachable from the resolved repo root, in BOTH layouts", () => {
    for (const start of [
      path.join(REPO_ROOT, "apps", "api", "src"),
      path.join(REPO_ROOT, "dist")
    ]) {
      const root = findRepoRoot(start);
      expect(existsSync(path.join(root, "scripts", "install-herdr.sh"))).toBe(true);
    }
  });

  it("does not use a fixed MODULE_DIR/../../.. offset (source-level guard)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(path.join(REPO_ROOT, "apps/api/src/herdr-install-port.ts"), "utf8");
    expect(src).toMatch(/findRepoRoot\(/);
    expect(src).not.toMatch(/new URL\("\.\.\/\.\.\/\.\.",\s*import\.meta\.url\)/);
  });
});
