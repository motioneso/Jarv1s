// scripts/publish-module-registry.ts
// #964: builds the module-registry publication set. For every module directory given
// (default: each child of external-modules/), it runs the JS-01 bundler, validates the
// manifest, packs a portable gzip tarball of exactly the on-disk trust set
// (jarvis.module.json + dist/** + sql/**), and emits index.json conforming to Task 1's
// registry schema. Runs only in CI (modules-registry.yml) and locally for testing —
// external-modules/ is dockerignored, the core image never ships it. Retention:
// current + 4 previous versions per module.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as tar from "tar";

import {
  ARTIFACT_FILENAME_RE,
  REGISTRY_INDEX_SCHEMA_VERSION,
  validateExternalModuleManifest,
  validateRegistryIndex,
  type ModuleRegistryArtifactRef,
  type ModuleRegistryEntry,
  type ModuleRegistryIndex
} from "../packages/module-registry/src/node.js";
import { buildExternalModule } from "./build-external-module.js";

export const REGISTRY_RETAINED_VERSIONS = 5;

/**
 * Fold the previous index entry's current version into previousVersions, newest first,
 * capped so current + previous ≤ REGISTRY_RETAINED_VERSIONS. Republishing the same
 * version replaces it in place instead of duplicating it.
 */
export function mergePreviousVersions(
  existing: ModuleRegistryEntry | undefined,
  next: ModuleRegistryArtifactRef
): readonly ModuleRegistryArtifactRef[] {
  if (!existing) return [];
  const chain: ModuleRegistryArtifactRef[] = [
    {
      version: existing.version,
      artifact: existing.artifact,
      sha256: existing.sha256,
      sizeBytes: existing.sizeBytes
    },
    ...existing.previousVersions
  ];
  return chain.filter((r) => r.version !== next.version).slice(0, REGISTRY_RETAINED_VERSIONS - 1);
}

/** Pack the module's trust set into `<id>-<version>.tgz` and return its artifact ref. */
export async function packModuleArtifact(
  moduleDir: string,
  outDir: string,
  id: string,
  version: string
): Promise<ModuleRegistryArtifactRef> {
  const artifact = `${id}-${version}.tgz`;
  if (!ARTIFACT_FILENAME_RE.test(artifact)) {
    throw new Error(`artifact filename fails registry schema: ${artifact}`);
  }
  // Exactly the hashable set from external/hash.ts (#964 Task 2) — nothing else.
  // README, src/, node_modules must never reach the wire.
  const members = ["jarvis.module.json", "dist"];
  if (existsSync(join(moduleDir, "sql"))) members.push("sql");
  const file = join(outDir, artifact);
  // portable: strips uid/gid/atime metadata so identical trees pack identically.
  await tar.create({ gzip: true, portable: true, cwd: resolve(moduleDir), file }, members);
  const bytes = readFileSync(file);
  return {
    version,
    artifact,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: statSync(file).size
  };
}

export interface BuildRegistryArtifactsOptions {
  readonly moduleDirs: readonly string[];
  readonly outDir: string;
  readonly previousIndex: ModuleRegistryIndex | null;
  readonly generatedAt: string;
}

export async function buildRegistryArtifacts(
  options: BuildRegistryArtifactsOptions
): Promise<ModuleRegistryIndex> {
  mkdirSync(options.outDir, { recursive: true });
  const modules: ModuleRegistryEntry[] = [];
  for (const moduleDir of options.moduleDirs) {
    const id = basename(resolve(moduleDir));
    await buildExternalModule(moduleDir);
    const raw: unknown = JSON.parse(readFileSync(join(moduleDir, "jarvis.module.json"), "utf8"));
    const validation = validateExternalModuleManifest(raw, id);
    if (!validation.ok) {
      // Fail the whole publish: a broken manifest must never reach the registry.
      throw new Error(`manifest invalid for ${id}: ${validation.errors.join("; ")}`);
    }
    const manifest = validation.manifest;
    const ref = await packModuleArtifact(moduleDir, options.outDir, id, manifest.version);
    const existing = options.previousIndex?.modules.find((m) => m.id === id);
    modules.push({
      ...ref,
      id,
      name: manifest.name,
      description: manifest.description ?? null,
      requiresCore: manifest.compatibility.jarv1s,
      capabilities: {
        permissions: [...new Set((manifest.assistantTools ?? []).map((t) => t.permissionId))],
        fetchHosts: manifest.fetchHosts ?? [],
        tools: (manifest.assistantTools ?? []).map((t) => ({ name: t.name, risk: t.risk })),
        ownsTables: manifest.database?.ownedTables ?? []
      },
      previousVersions: mergePreviousVersions(existing, ref)
    });
  }
  const index: ModuleRegistryIndex = {
    schemaVersion: REGISTRY_INDEX_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    modules
  };
  // Self-check: the index we publish must round-trip our own validator.
  const check = validateRegistryIndex(JSON.parse(JSON.stringify(index)));
  if (!check.index || check.errors.length > 0) {
    throw new Error(`generated index fails own schema: ${check.errors.join("; ")}`);
  }
  writeFileSync(join(options.outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}

// CLI: tsx scripts/publish-module-registry.ts --out dist/registry [--previous-index p]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const argValue = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const outDir = argValue("--out") ?? "dist/registry";
  const previousIndexPath = argValue("--previous-index");
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const externalModulesDir = join(repoRoot, "external-modules");
  const moduleDirs = readdirSync(externalModulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(externalModulesDir, e.name));
  let previousIndex: ModuleRegistryIndex | null = null;
  if (previousIndexPath && existsSync(previousIndexPath)) {
    const parsed = validateRegistryIndex(JSON.parse(readFileSync(previousIndexPath, "utf8")));
    // Tolerate a corrupt previous index (history reset) — warn and publish fresh.
    if (!parsed.index)
      console.warn(`previous index invalid, ignoring: ${parsed.errors.join("; ")}`);
    previousIndex = parsed.index;
  }
  buildRegistryArtifacts({
    moduleDirs,
    outDir,
    previousIndex,
    generatedAt: new Date().toISOString()
  })
    .then((index) => console.log(`published ${index.modules.length} module(s) to ${outDir}`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
