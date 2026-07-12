import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { scanModuleWeb } from "../../packages/settings-ui/src/vite.js";

/**
 * Guards the module-web-registry (#799) browser-safety invariant: every package that declares a
 * `"./web"` export is bundled straight into the browser build (see `@jarv1s/module-web-sdk`'s
 * docstring and CLAUDE.md "Secrets never escape" / "Shared Browser Bundle"). None of those files —
 * nor anything they import, transitively, through relative imports or `@jarv1s/*` workspace
 * packages — may reach a node builtin or a backend-only package (fastify, kysely, pg, undici,
 * `@jarv1s/db`). A single stray `import "node:fs"` deep in the graph would break the Vite browser
 * build or silently ship a backend dependency to the client.
 *
 * This walks the real import graph starting from every discovered `./web` entry file (plus
 * `@jarv1s/module-web-sdk` itself), so it automatically covers every future module that docks
 * onto the plugin seam — not just sports.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FORBIDDEN_BARE_SPECIFIERS = ["fastify", "kysely", "pg", "pg-boss", "undici", "@jarv1s/db"];

const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/g;

function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function resolvePackageDir(packageName: string): string | null {
  const direct = join(REPO_ROOT, "packages", packageName.replace(/^@jarv1s\//, ""));
  if (existsSync(join(direct, "package.json"))) return direct;

  // Fall back to scanning packages/* for a package.json whose "name" matches, in case the
  // directory name doesn't match the package's scoped name.
  const packagesDir = join(REPO_ROOT, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { name?: string };
    if (pkgJson.name === packageName) return join(packagesDir, entry.name);
  }
  return null;
}

function resolveFile(candidate: string): string | null {
  // NodeNext ESM: relative imports are written `./x.js` but the source on disk is `x.ts`/`x.tsx`.
  const stripped = candidate.replace(/\.(js|jsx)$/, "");
  for (const base of stripped === candidate ? [candidate] : [stripped, candidate]) {
    for (const ext of ["", ".ts", ".tsx", ".js", ".jsx"]) {
      const withExt = base + ext;
      if (existsSync(withExt) && statSync(withExt).isFile()) return withExt;
    }
  }
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const indexCandidate = join(candidate, "index" + ext);
    if (existsSync(indexCandidate) && statSync(indexCandidate).isFile()) return indexCandidate;
  }
  return null;
}

function resolveSpecifierToFile(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith(".")) {
    return resolveFile(join(dirname(fromFile), specifier));
  }
  if (specifier.startsWith("@jarv1s/")) {
    const packageDir = resolvePackageDir(specifier);
    if (!packageDir) return null;
    const pkgJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      exports?: Record<string, string>;
    };
    const entry = pkgJson.exports?.["."];
    if (!entry) return null;
    return resolve(packageDir, entry);
  }
  return null; // third-party packages (react, lucide-react, @tanstack/*) — not walked further.
}

function walkImportGraph(entryFile: string): { visited: Set<string>; violations: string[] } {
  const visited = new Set<string>();
  const violations: string[] = [];
  const stack = [entryFile];

  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const source = readFileSync(file, "utf8");
    for (const specifier of extractSpecifiers(source)) {
      if (specifier.startsWith("node:")) {
        violations.push(`${file} imports node builtin "${specifier}"`);
        continue;
      }
      if (FORBIDDEN_BARE_SPECIFIERS.some((forbidden) => specifier === forbidden)) {
        violations.push(`${file} imports backend-only package "${specifier}"`);
        continue;
      }

      const resolved = resolveSpecifierToFile(specifier, file);
      if (resolved && !visited.has(resolved)) stack.push(resolved);
    }
  }

  return { visited, violations };
}

describe("module web browser safety (#799)", () => {
  it("never reaches a node builtin or backend-only package from @jarv1s/module-web-sdk", () => {
    const entry = resolve(REPO_ROOT, "packages/module-web-sdk/src/index.ts");
    const { violations } = walkImportGraph(entry);
    expect(violations).toEqual([]);
  });

  it("never reaches a node builtin or backend-only package from any discovered ./web contribution", () => {
    const result = scanModuleWeb({ rootDir: REPO_ROOT });
    expect(result.routes.length).toBeGreaterThan(0); // sanity: the scan actually found sports

    for (const moduleId of Object.keys(result.contributions)) {
      const packageDir = resolvePackageDir(`@jarv1s/${moduleId}`);
      expect(packageDir, `resolve package dir for module "${moduleId}"`).toBeTruthy();
      const pkgJson = JSON.parse(readFileSync(join(packageDir!, "package.json"), "utf8")) as {
        exports?: Record<string, string>;
      };
      const webEntry = pkgJson.exports?.["./web"];
      expect(webEntry, `"./web" export for module "${moduleId}"`).toBeTruthy();

      const entryFile = resolve(packageDir!, webEntry!);
      const { violations } = walkImportGraph(entryFile);
      expect(violations, `module "${moduleId}"`).toEqual([]);
    }
  });

  it("never reaches a node builtin or backend-only package from the job-search external web entry", () => {
    // External modules live outside packages/* so scanModuleWeb never sees them,
    // but their web bundle ships to the browser all the same (JS-06, #935). Walk
    // the source entry directly so a stray node/backend import via domain/ or
    // lib/ can't creep into the browser graph unnoticed.
    const entry = resolve(REPO_ROOT, "external-modules/job-search/src/web/index.ts");
    expect(existsSync(entry), "job-search external web entry exists").toBe(true);
    const { visited, violations } = walkImportGraph(entry);
    expect(visited.size).toBeGreaterThan(1); // sanity: the walk actually traversed imports
    expect(violations).toEqual([]);
  });
});
