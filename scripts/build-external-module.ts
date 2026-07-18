// scripts/build-external-module.ts
// JS-01 (#930): bundles an external module package's two artifacts. Kept at the
// repo root (not inside the package) because it needs the workspace's esbuild
// and the SDK source path; the core image never runs it (external-modules/ is
// dockerignored and this script is only wired to explicit build:external:*
// package scripts).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { build } from "esbuild";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export async function buildExternalModule(moduleDir: string): Promise<void> {
  const dir = resolve(moduleDir);
  // Worker: self-contained CJS for `node dist/worker.js` in a scrubbed env with
  // no node_modules — the SDK is compiled in via the workspace source alias.
  await build({
    entryPoints: [join(dir, "src/worker/index.ts")],
    outfile: join(dir, "dist/worker.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: false,
    logLevel: "silent",
    alias: { "@jarv1s/module-sdk/worker": join(repoRoot, "packages/module-sdk/src/worker.ts") }
  });
  // Web: browser ESM; must stay react-free (JSX compiles to the module's own
  // `h`/`Fragment` from src/web/runtime.ts, which delegate to the host React
  // on the frozen runtime global — asserted by the bundle-hygiene test).
  // Optional: worker-only modules (finance FIN-01, #1146) have no web surface
  // yet — `web` is an optional manifest section, so the build must not demand
  // an entrypoint the manifest never declares.
  const webEntry = join(dir, "src/web/index.ts");
  if (!existsSync(webEntry)) return;
  await build({
    entryPoints: [webEntry],
    outfile: join(dir, "dist/web/index.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    sourcemap: false,
    logLevel: "silent",
    jsx: "transform",
    jsxFactory: "h",
    jsxFragment: "Fragment"
  });
}

// CLI: `tsx scripts/build-external-module.ts external-modules/job-search`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: tsx scripts/build-external-module.ts <module-dir>");
    process.exit(1);
  }
  buildExternalModule(target).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
