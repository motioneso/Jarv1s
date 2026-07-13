// #996/#860: shared external-modules-dir resolver. Before this file, 4+ call sites
// (server.ts, worker.ts, start-jarv1s.ts, module-reconcile.ts) each independently read
// `env.JARVIS_MODULES_DIR ?? null`, which meant "no dir" and "gate off" were coupled —
// the #917 flag removal (#996) needs a dev/test default that does NOT depend on an env
// var, so this resolver adds the fallback chain those call sites lacked.
//
// CANNOT anchor on a fixed `MODULE_DIR/../..` offset: this module is consumed as SOURCE
// (never esbuild-bundled — see node.ts's header, "Server-only entry... consumed via
// workspace resolution"), but is invoked from both `tsx`-run scripts (cwd = repo root)
// and the bundled api/worker (`import.meta.url` collapses to the bundle dir under
// esbuild — the known bundled-path-resolution trap, see
// packages/cli-runner/src/catalog.ts's findRepoRoot for the same problem solved the
// same way). So: explicit env override first, then walk UP from this module's own
// directory to the nearest pnpm-workspace.yaml (the repo-root marker, present in both
// the `tsx`-from-src case and the container image, since the prod image's WORKDIR is
// the repo root copy), then the container WORKDIR fallback, then cwd.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function resolveModulesDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.JARVIS_MODULES_DIR) return env.JARVIS_MODULES_DIR;

  let dir = MODULE_DIR;
  for (let i = 0; i < 16; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return path.join(dir, "data", "modules");
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (existsSync(path.join("/app", "pnpm-workspace.yaml"))) {
    return path.join("/app", "data", "modules");
  }
  return path.join(process.cwd(), "data", "modules");
}
