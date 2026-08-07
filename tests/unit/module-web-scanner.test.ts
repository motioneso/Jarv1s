import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { emitWebVirtualModule, scanModuleWeb } from "../../packages/settings-ui/src/vite.js";

let roots: string[] = [];

async function makePackage(
  rootDir: string,
  dirName: string,
  packageName: string,
  manifestBody: string,
  exportsField: Record<string, string> = { ".": "./src/index.ts", "./web": "./src/web/index.tsx" }
) {
  const packageDir = join(rootDir, "packages", dirName);
  await mkdir(join(packageDir, "src"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: packageName, type: "module", exports: exportsField }),
    "utf8"
  );
  await writeFile(join(packageDir, "src", "manifest.ts"), manifestBody, "utf8");
}

async function makeRoot() {
  const rootDir = await mkdtemp(join(tmpdir(), "moss-module-web-"));
  roots.push(rootDir);
  return rootDir;
}

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

describe("module web scanner", () => {
  it("collects navigation entries only from packages that declare a ./web export", async () => {
    const rootDir = await makeRoot();
    await makePackage(
      rootDir,
      "fixture",
      "@moss/fixture",
      `export const fixtureModuleManifest = {
        id: "fixture",
        name: "Fixture",
        lifecycle: "user-toggleable",
        navigation: [
          {
            id: "fixture",
            label: "Fixture",
            path: "/fixture",
            icon: "star",
            order: 40,
            permissionId: "fixture.view"
          }
        ]
      };`
    );
    // No "./web" export declared — must be skipped entirely, even though it has a manifest with
    // navigation (mirrors a settings-only module that hasn't migrated onto the web plugin seam).
    await makePackage(
      rootDir,
      "settings-only",
      "@moss/settings-only",
      `export const settingsOnlyModuleManifest = {
        id: "settings-only",
        name: "Settings Only",
        lifecycle: "user-toggleable",
        navigation: [
          {
            id: "settings-only",
            label: "Settings Only",
            path: "/settings-only",
            icon: "gear",
            order: 50
          }
        ]
      };`,
      { ".": "./src/index.ts", "./settings": "./src/settings/index.tsx" }
    );

    const result = scanModuleWeb({ rootDir });

    expect(result.routes).toEqual([
      {
        moduleId: "fixture",
        moduleName: "Fixture",
        id: "fixture",
        label: "Fixture",
        path: "/fixture",
        icon: "star",
        order: 40,
        permissionId: "fixture.view"
      }
    ]);
    expect(result.contributions.fixture).toContain('import("@moss/fixture/web")');
    expect(result.contributions["settings-only"]).toBeUndefined();
  });

  it("throws when two modules claim the same web route path", async () => {
    const rootDir = await makeRoot();
    const manifest = (moduleId: string) => `export const manifest = {
      id: "${moduleId}",
      name: "${moduleId}",
      lifecycle: "user-toggleable",
      navigation: [
        {
          id: "${moduleId}",
          label: "${moduleId}",
          path: "/fixture",
          icon: "star",
          order: 10
        }
      ]
    };`;
    await makePackage(rootDir, "fixture-one", "@moss/fixture-one", manifest("one"));
    await makePackage(rootDir, "fixture-two", "@moss/fixture-two", manifest("two"));

    expect(() => scanModuleWeb({ rootDir })).toThrow(/duplicate web route path "\/fixture"/i);
  });

  it("throws when a ./web export exists but the manifest cannot be parsed", async () => {
    const rootDir = await makeRoot();
    await makePackage(rootDir, "fixture", "@moss/fixture", `export const NOT_A_MANIFEST = 42;`);

    expect(() => scanModuleWeb({ rootDir })).toThrow(/manifest could not be parsed/i);
  });

  it("emits the virtual module exports consumed by web", async () => {
    const rootDir = await makeRoot();
    await makePackage(
      rootDir,
      "fixture",
      "@moss/fixture",
      `export const fixtureModuleManifest = {
        id: "fixture",
        name: "Fixture",
        lifecycle: "user-toggleable",
        navigation: [
          {
            id: "fixture",
            label: "Fixture",
            path: "/fixture",
            icon: "star",
            order: 40
          }
        ]
      };`
    );

    const moduleSource = emitWebVirtualModule(scanModuleWeb({ rootDir }));

    expect(moduleSource).toContain("export const MODULE_WEB_ROUTES");
    expect(moduleSource).toContain("export const MODULE_WEB_CONTRIBUTIONS");
    expect(moduleSource).toContain(
      '{ moduleId: "fixture", load: () => import("@moss/fixture/web") }'
    );
  });
});
