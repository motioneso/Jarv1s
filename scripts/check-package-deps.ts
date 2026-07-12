import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { extname, join } from "node:path";

/**
 * Module-boundary declared-dependency gate (#802).
 *
 * "Modules collaborate only through declared public APIs" is a Hard Invariant, but nothing
 * previously stopped a package from importing a workspace sibling that pnpm's hoisted store
 * happens to resolve without ever declaring it in `package.json` — or from keeping a stale
 * `@jarv1s/*` dependency around after the last import of it was deleted. Both drift silently:
 * the build keeps working (pnpm hoists everything into one `node_modules`), so nothing catches
 * it until a hoisting change or a fresh install breaks the package in isolation.
 *
 * For every `packages/*` workspace package, this scans `src/**` (test directories excluded —
 * they legitimately import root-only devDependencies like `vitest` that are never declared
 * per-package) and:
 *  - **undeclared**: an import specifier resolves to an npm package not listed in that
 *    package's `dependencies`/`peerDependencies` → error. Type-only imports count too — they
 *    still require the dependency for typechecking.
 *  - **unused**: a declared `@jarv1s/*` workspace dependency with zero import hits anywhere in
 *    the package's `src/**` → error. Scoped to workspace deps only — external packages can be
 *    required only for side effects or re-exported types in ways this regex scan would miss,
 *    so flagging those would be noisier than useful.
 */

const rootDirectory = process.cwd();
const packagesRoot = join(rootDirectory, "packages");

const scannedExtensions = new Set([".ts", ".tsx"]);
const builtinModuleNames = new Set(builtinModules);

/**
 * Regexes over `import ... from "x"`, `export ... from "x"`, `import("x")`, `import "x"`.
 *
 * `fromClausePattern` and `sideEffectImportPattern` are anchored to the start of a physical
 * line (optionally indented) so they only match real statements — not the word "from" or
 * "import" appearing inside a comment sentence or a string literal (both occur in this
 * codebase: doc comments like `derive a key from "undefined"`, and a code-gen template
 * literal in settings-ui's scanner that emits the text `import("...")` as generated source).
 * `dynamicImportPattern` can't be anchored the same way (`await import("x")` is a valid
 * expression anywhere in a line), so callers filter its captures through
 * `isPlausibleSpecifier` instead to reject interpolated/non-literal-looking captures.
 */
const fromClausePattern = /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm;
const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const sideEffectImportPattern = /^[ \t]*import\s+["']([^"']+)["']/gm;

interface PackageDescriptor {
  readonly name: string;
  readonly directory: string;
  readonly dependencies: ReadonlySet<string>;
  readonly declaredDependencyNames: ReadonlySet<string>;
}

interface Violation {
  readonly package: string;
  readonly kind: "undeclared" | "unused" | "cycle";
  readonly detail: string;
}

async function main(): Promise<void> {
  const packageDirectories = await listPackageDirectories();
  const violations: Violation[] = [];

  for (const packageDirectory of packageDirectories) {
    const descriptor = await loadPackageDescriptor(packageDirectory);
    if (!descriptor) {
      continue;
    }

    const referencedPackages = await scanReferencedPackages(descriptor);

    for (const referenced of referencedPackages) {
      if (referenced === descriptor.name) {
        continue; // self-reference (e.g. a package importing its own published name) — ignore
      }
      if (!descriptor.dependencies.has(referenced)) {
        violations.push({
          package: descriptor.name,
          kind: "undeclared",
          detail: `imports "${referenced}" but it is not in dependencies/peerDependencies`
        });
      }
    }

    for (const declared of descriptor.declaredDependencyNames) {
      if (!declared.startsWith("@jarv1s/")) {
        continue; // unused-check is scoped to workspace deps only
      }
      if (!referencedPackages.has(declared)) {
        violations.push({
          package: descriptor.name,
          kind: "unused",
          detail: `declares "${declared}" but never imports it under src/**`
        });
      }
    }
  }

  const dependencyGraph = new Map<string, Set<string>>();
  for (const packageDirectory of packageDirectories) {
    const descriptor = await loadPackageDescriptor(packageDirectory);
    if (!descriptor) continue;
    const workspaceDeps = new Set(
      [...descriptor.declaredDependencyNames].filter((name) => name.startsWith("@jarv1s/"))
    );
    dependencyGraph.set(descriptor.name, workspaceDeps);
  }

  for (const cyclePath of detectDependencyCycles(dependencyGraph)) {
    violations.push({
      package: cyclePath[0]!,
      kind: "cycle",
      detail: cyclePath.join(" -> ")
    });
  }

  if (violations.length > 0) {
    console.error("Package dependency violations (#802 module boundary enforcement):");
    for (const violation of violations) {
      console.error(`- [${violation.kind}] ${violation.package}: ${violation.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("No undeclared or unused workspace package dependencies.");
}

async function listPackageDirectories(): Promise<string[]> {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesRoot, entry.name));
}

async function loadPackageDescriptor(packageDirectory: string): Promise<PackageDescriptor | null> {
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(join(packageDirectory, "package.json"), "utf8");
  } catch {
    return null; // no package.json — not a real workspace package
  }

  const manifest = JSON.parse(manifestRaw) as {
    name?: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  if (!manifest.name) {
    return null;
  }

  const declaredDependencyNames = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {})
  ]);

  return {
    name: manifest.name,
    directory: packageDirectory,
    dependencies: declaredDependencyNames,
    declaredDependencyNames: new Set(Object.keys(manifest.dependencies ?? {}))
  };
}

/**
 * DFS cycle detection over the declared `@jarv1s/*` dependency graph (#834 — jobs, settings,
 * and proactive-monitoring formed a cycle because a package.json-declared dependency doesn't
 * show up any other way; `check:package-deps`'s existing undeclared/unused checks don't catch
 * cycles, so this is a separate pass over the same descriptors).
 */
export function detectDependencyCycles(
  graph: ReadonlyMap<string, ReadonlySet<string>>
): string[][] {
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  function visit(node: string): void {
    if (onStack.has(node)) {
      const start = stack.indexOf(node);
      const cyclePath = [...stack.slice(start), node];
      const key = canonicalCycleKey(cyclePath);
      if (!seenCycleKeys.has(key)) {
        seenCycleKeys.add(key);
        cycles.push(cyclePath);
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      visit(dependency);
    }

    stack.pop();
    onStack.delete(node);
  }

  for (const node of graph.keys()) {
    visit(node);
  }

  return cycles;
}

/** Rotates a cycle path to start at its lexicographically smallest node, so the same cycle
 *  discovered from different entry points dedupes to one report. */
function canonicalCycleKey(cyclePath: string[]): string {
  const withoutRepeat = cyclePath.slice(0, -1);
  const minIndex = withoutRepeat.reduce(
    (best, _, index) => (withoutRepeat[index]! < withoutRepeat[best]! ? index : best),
    0
  );
  const rotated = [...withoutRepeat.slice(minIndex), ...withoutRepeat.slice(0, minIndex)];
  return rotated.join(">");
}

async function scanReferencedPackages(descriptor: PackageDescriptor): Promise<Set<string>> {
  const referenced = new Set<string>();
  const srcRoot = join(descriptor.directory, "src");

  for await (const filePath of walkSourceFiles(srcRoot)) {
    const contents = await readFile(filePath, "utf8");

    for (const specifier of extractSpecifiers(contents)) {
      const packageName = resolvePackageName(specifier);
      if (packageName) {
        referenced.add(packageName);
      }
    }
  }

  return referenced;
}

function extractSpecifiers(contents: string): string[] {
  const specifiers: string[] = [];

  for (const pattern of [fromClausePattern, dynamicImportPattern, sideEffectImportPattern]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(contents)) !== null) {
      const captured = match[1];
      if (captured !== undefined && isPlausibleSpecifier(captured)) {
        specifiers.push(captured);
      }
    }
  }

  return specifiers;
}

/**
 * Rejects captures that can't be a real static import specifier: template-literal
 * interpolation (`${...}`), embedded backticks, or whitespace. A real specifier is always a
 * bare literal string. This guards `dynamicImportPattern`, which can't be line-anchored,
 * against matching `import("...")` text inside a generated-source template literal (see
 * settings-ui's scanner.ts, which builds virtual-module code as a string).
 */
function isPlausibleSpecifier(specifier: string): boolean {
  return !/[$`\s]/.test(specifier);
}

/** Returns the npm package name a specifier resolves to, or null for relative/builtin specifiers. */
function resolvePackageName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return null; // relative import — same package, not a dependency
  }
  if (specifier.startsWith("node:")) {
    return null; // explicit builtin
  }

  const segments = specifier.split("/");
  const packageName = specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? specifier);

  if (builtinModuleNames.has(packageName)) {
    return null; // bare builtin (e.g. "fs", "path") imported without the "node:" prefix
  }

  return packageName;
}

async function* walkSourceFiles(directory: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return; // package has no src/ — nothing to scan
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "tests") {
        continue; // test dirs legitimately reach into root-only devDependencies (e.g. vitest)
      }
      yield* walkSourceFiles(join(directory, entry.name));
      continue;
    }

    if (
      entry.isFile() &&
      scannedExtensions.has(extname(entry.name)) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      yield join(directory, entry.name);
    }
  }
}

await main();
