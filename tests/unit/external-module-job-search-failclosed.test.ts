// tests/unit/external-module-job-search-failclosed.test.ts
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getExternalModuleRegistrations, hashExternalPackage } from "@jarv1s/module-registry/node";

import { buildExternalModule } from "../../scripts/build-external-module.js";

// JS-01 (#930, sensitive tier): a package that doesn't match the contract must
// simply not load. Each case plants one hostile/malformed mutation of the REAL
// built artifact in a temp modules dir and asserts fail-closed behavior.
const sourceDir = fileURLToPath(new URL("../../external-modules/job-search", import.meta.url));

let root: string;
let modulesDir: string;
let dir: string;

beforeAll(async () => {
  await buildExternalModule(sourceDir);
}, 60_000);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "job-search-failclosed-"));
  modulesDir = join(root, "modules");
  dir = join(modulesDir, "job-search");
  mkdirSync(join(dir, "dist/web"), { recursive: true });
  cpSync(join(sourceDir, "jarvis.module.json"), join(dir, "jarvis.module.json"));
  cpSync(join(sourceDir, "dist"), join(dir, "dist"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const discover = () => getExternalModuleRegistrations({ modulesDir, coreVersion: "0.1.0" });

const mutateManifest = (mutate: (manifest: Record<string, unknown>) => void): void => {
  const manifest = JSON.parse(readFileSync(join(dir, "jarvis.module.json"), "utf8")) as Record<
    string,
    unknown
  >;
  mutate(manifest);
  writeFileSync(join(dir, "jarvis.module.json"), JSON.stringify(manifest));
};

describe("job-search fail-closed artifact fixtures (#930)", () => {
  it("discovers the untouched artifact with manifest and package hashes", () => {
    const result = discover();
    expect(result.rejected).toEqual([]);
    expect(result.discoveries).toHaveLength(1);
    expect(result.discoveries[0]!.id).toBe("job-search");
    expect(result.discoveries[0]!.manifestHash.startsWith("sha256:")).toBe(true);
    expect(result.discoveries[0]!.packageHash.startsWith("sha256:")).toBe(true);
  });

  it("tampering dist/worker.js changes the package hash (drift detection input)", () => {
    const before = hashExternalPackage(dir);
    writeFileSync(join(dir, "dist/worker.js"), `${readFileSync(join(dir, "dist/worker.js"))}\n//x`);
    expect(hashExternalPackage(dir)).not.toBe(before);
  });

  it("never follows a symlink planted under dist/web (inert: skipped from the hash)", () => {
    // Observed platform shape (hash.ts walkFiles, deliberate per #917 Codex
    // re-QA): a NESTED symlink Dirent is neither file nor directory, so it is
    // never followed and never hashed — hostile symlink content cannot enter
    // the trust hash, and web-assets.ts realpath containment refuses to serve
    // it. Discovery proceeds with the hash identical to the clean artifact.
    const clean = hashExternalPackage(dir);
    symlinkSync(join(root, ".."), join(dir, "dist/web/escape"));
    expect(hashExternalPackage(dir)).toBe(clean);
    const result = discover();
    expect(result.discoveries).toHaveLength(1);
  });

  it("rejects a top-level hashable path symlinked outside the package", () => {
    // Top-level escapes (manifest / worker bundle / web root) DO hard-fail:
    // realpath containment throws ExternalPackageEscapeError and the module
    // is rejected rather than hashed.
    const outside = join(root, "outside-worker.js");
    writeFileSync(outside, "// hostile content outside the package\n");
    rmSync(join(dir, "dist/worker.js"));
    symlinkSync(outside, join(dir, "dist/worker.js"));
    expect(() => hashExternalPackage(dir)).toThrow();
    const result = discover();
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("rejects a path-traversal web entrypoint", () => {
    mutateManifest((manifest) => {
      manifest.web = { entrypoint: "../outside.js", contractVersion: 1 };
    });
    const result = discover();
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("rejects an unsupported workerContractVersion", () => {
    mutateManifest((manifest) => {
      manifest.runtime = { workerEntrypoint: "dist/worker.js", workerContractVersion: 2 };
    });
    const result = discover();
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("passes a future web contractVersion through to the host gate", () => {
    // The manifest layer accepts any positive int; the apps/web loader is the
    // gate that requires exactly 1 and refuses to mount anything else. Assert
    // the declared value survives discovery so that gate sees it.
    mutateManifest((manifest) => {
      manifest.web = { entrypoint: "dist/web/index.js", contractVersion: 2 };
    });
    const result = discover();
    expect(result.discoveries).toHaveLength(1);
    expect(result.discoveries[0]!.manifest.web?.contractVersion).toBe(2);
  });

  it("rejects a malformed manifest JSON", () => {
    writeFileSync(join(dir, "jarvis.module.json"), "{ not json");
    const result = discover();
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("rejects a dir name that does not equal the manifest id", () => {
    const renamed = join(modulesDir, "job-search-x");
    cpSync(dir, renamed, { recursive: true });
    rmSync(dir, { recursive: true, force: true });
    const result = discover();
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });
});
