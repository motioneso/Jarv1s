import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getExternalModuleRegistrations } from "@jarv1s/module-registry/node";

let root: string;
let modulesDir: string;

const validManifest = (id: string) =>
  JSON.stringify({
    id,
    name: "Acme Widgets",
    version: "0.1.0",
    publisher: "Acme, Inc.",
    lifecycle: "optional",
    compatibility: { jarv1s: ">=0.1.0" }
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "extmod-loader-"));
  modulesDir = join(root, "modules");
  mkdirSync(modulesDir, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("getExternalModuleRegistrations (#917)", () => {
  it("returns an empty result when the dir does not exist", () => {
    const result = getExternalModuleRegistrations({
      modulesDir: join(root, "nope"),
      coreVersion: "0.1.0"
    });
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("discovers a valid module and hashes it", () => {
    const dir = join(modulesDir, "acme-widgets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "jarvis.module.json"), validManifest("acme-widgets"));

    const result = getExternalModuleRegistrations({ modulesDir, coreVersion: "0.1.0" });
    expect(result.discoveries).toHaveLength(1);
    expect(result.discoveries[0]!.id).toBe("acme-widgets");
    expect(result.discoveries[0]!.manifestHash.startsWith("sha256:")).toBe(true);
    expect(result.discoveries[0]!.packageHash.startsWith("sha256:")).toBe(true);
  });

  it("rejects a module whose manifest id != directory name", () => {
    const dir = join(modulesDir, "acme-widgets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "jarvis.module.json"), validManifest("something-else"));

    const result = getExternalModuleRegistrations({ modulesDir, coreVersion: "0.1.0" });
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("directory");
  });

  it("rejects a module with invalid JSON", () => {
    const dir = join(modulesDir, "broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "jarvis.module.json"), "{ not json");

    const result = getExternalModuleRegistrations({ modulesDir, coreVersion: "0.1.0" });
    expect(result.discoveries).toEqual([]);
    expect(result.rejected[0]!.reason.toLowerCase()).toContain("json");
  });

  it("rejects a symlinked directory that escapes the modules root", () => {
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "jarvis.module.json"), validManifest("escapee"));
    symlinkSync(outside, join(modulesDir, "escapee"), "dir");

    const result = getExternalModuleRegistrations({ modulesDir, coreVersion: "0.1.0" });
    expect(result.discoveries).toEqual([]);
    expect(result.rejected[0]!.reason.toLowerCase()).toContain("symlink");
  });
});
