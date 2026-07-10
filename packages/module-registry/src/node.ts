// Server-only entry for @jarv1s/module-registry (#917). Everything reachable from
// here may use node:* (fs, crypto). The browser-safe surface stays in ./index.ts.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

import { hashCanonicalManifest, hashExternalPackage } from "./external/hash.js";
import { MODULE_ID_RE, validateExternalModuleManifest } from "./external/validate.js";
import type {
  ExternalModuleDiscovery,
  ExternalModuleLoadResult,
  ExternalModuleRejection
} from "./external/types.js";

export * from "./external/hash.js";

/**
 * Discover external modules under `modulesDir` (#917). Server-only. Read-only: never
 * writes into the mount. Fail-closed per directory — any error (bad slug, symlink
 * escape, missing/invalid manifest, validation failure) rejects THAT module with a
 * reason and never throws, so one bad module can't blank the whole set. Callers gate
 * the call behind JARVIS_ENABLE_EXTERNAL_MODULES; the loader itself just reads a dir.
 */
export function getExternalModuleRegistrations(options: {
  readonly modulesDir: string;
  readonly coreVersion?: string;
}): ExternalModuleLoadResult {
  const { modulesDir, coreVersion } = options;
  const discoveries: ExternalModuleDiscovery[] = [];
  const rejected: ExternalModuleRejection[] = [];

  if (!existsSync(modulesDir)) {
    return { discoveries, rejected };
  }

  // Resolve the root through symlinks once so we can prove each module dir is contained.
  const rootReal = realpathSync(modulesDir);

  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    // A module directory's name IS the module id — reject non-slug names outright
    // (also blocks any "." / ".." style trickery the fs might surface).
    const id = entry.name;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!MODULE_ID_RE.test(id)) {
      rejected.push({ id, reason: `directory name "${id}" is not a valid module id slug` });
      continue;
    }

    // #917 C1: the whole per-directory body is wrapped so ANY throw rejects only THIS
    // module — this is what makes discovery fail-closed. realpathSync throws ENOENT on a
    // dangling symlink (and EACCES on an unreadable one), and hashExternalPackage's
    // readFileSync can throw on a TOCTOU race (a file vanishing mid-scan); without this
    // backstop any one of those would escape the loop and blank the entire discovery set.
    try {
      const dir = join(modulesDir, id);
      // Symlink-escape guard: the real path must stay inside the real modules root.
      const dirReal = realpathSync(dir);
      if (dirReal !== rootReal && !dirReal.startsWith(rootReal + sep)) {
        rejected.push({ id, reason: `symlink target escapes the modules root: ${id}` });
        continue;
      }

      const manifestPath = join(dir, "jarvis.module.json");
      if (!existsSync(manifestPath)) {
        rejected.push({ id, reason: `missing jarvis.module.json in ${id}` });
        continue;
      }

      let raw: unknown;
      try {
        // Inner catch yields the nicer "invalid JSON" reason; the outer catch is the
        // backstop for realpath/hash/TOCTOU throws. Both coexist intentionally.
        raw = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch (error) {
        rejected.push({ id, reason: `invalid JSON in ${id}/jarvis.module.json: ${String(error)}` });
        continue;
      }

      const validation = validateExternalModuleManifest(raw, id, coreVersion);
      if (!validation.ok) {
        rejected.push({ id, reason: validation.errors.join("; ") });
        continue;
      }

      discoveries.push({
        id,
        dir,
        manifest: validation.manifest,
        manifestHash: hashCanonicalManifest(validation.manifest),
        packageHash: hashExternalPackage(dir)
      });
    } catch (error) {
      rejected.push({ id, reason: `failed to load module "${id}": ${String(error)}` });
      continue;
    }
  }

  // Deterministic order so downstream lists/hashes are stable.
  discoveries.sort((a, b) => a.id.localeCompare(b.id));
  rejected.sort((a, b) => a.id.localeCompare(b.id));
  return { discoveries, rejected };
}
