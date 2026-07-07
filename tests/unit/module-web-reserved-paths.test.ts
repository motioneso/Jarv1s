import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { scanModuleWeb, SHELL_RESERVED_WEB_PATHS } from "../../packages/settings-ui/src/vite.js";
import { webRoutes } from "../../apps/web/src/app-route-metadata.js";
import { MODULE_WEB_ROUTES } from "virtual:jarvis-module-web";

let roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

async function makeRoot() {
  const rootDir = await mkdtemp(join(tmpdir(), "jarvis-module-web-reserved-"));
  roots.push(rootDir);
  return rootDir;
}

async function makeFixturePackage(rootDir: string, manifestBody: string) {
  const packageDir = join(rootDir, "packages", "fixture");
  await mkdir(join(packageDir, "src"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "@jarv1s/fixture",
      type: "module",
      exports: { ".": "./src/index.ts", "./web": "./src/web/index.tsx" }
    }),
    "utf8"
  );
  await writeFile(join(packageDir, "src", "manifest.ts"), manifestBody, "utf8");
}

describe("module web scanner reserved paths", () => {
  it("keeps the scanner's shell-reserved denylist in sync with the shell's own route table", () => {
    const moduleRouteIds = new Set(MODULE_WEB_ROUTES.map((route) => route.moduleId));
    const shellOwnedPaths = webRoutes
      .filter((route) => !moduleRouteIds.has(route.id))
      .map((route) => route.path)
      .sort();

    expect([...SHELL_RESERVED_WEB_PATHS].sort()).toEqual(shellOwnedPaths);
  });

  it("throws when a module's web route path collides with a shell-reserved path", async () => {
    const rootDir = await makeRoot();
    await makeFixturePackage(
      rootDir,
      `export const fixtureModuleManifest = {
        id: "fixture",
        name: "Fixture",
        lifecycle: "user-toggleable",
        navigation: [
          {
            id: "fixture",
            label: "Fixture",
            path: "/settings",
            icon: "star",
            order: 40
          }
        ]
      };`
    );

    expect(() => scanModuleWeb({ rootDir })).toThrow(
      /module web route path "\/settings" is reserved by the app shell/i
    );
  });
});
