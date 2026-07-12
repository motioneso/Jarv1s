import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as tar from "tar";
import { afterAll, describe, expect, it } from "vitest";

import type {
  ModuleRegistryArtifactRef,
  ModuleRegistryEntry
} from "../../packages/module-registry/src/node.js";
import {
  mergePreviousVersions,
  packModuleArtifact,
  REGISTRY_RETAINED_VERSIONS
} from "../../scripts/publish-module-registry.js";

const ref = (version: string): ModuleRegistryArtifactRef => ({
  version,
  artifact: `job-search-${version}.tgz`,
  sha256: "a".repeat(64),
  sizeBytes: 10
});

const entry = (version: string, previous: ModuleRegistryArtifactRef[]): ModuleRegistryEntry => ({
  id: "job-search",
  name: "Job Search",
  description: null,
  requiresCore: ">=0.0.0",
  capabilities: { permissions: [], fetchHosts: [], tools: [], ownsTables: [] },
  previousVersions: previous,
  ...ref(version)
});

describe("mergePreviousVersions", () => {
  it("moves the old current version to the head of previousVersions", () => {
    const merged = mergePreviousVersions(entry("1.0.0", [ref("0.9.0")]), ref("1.1.0"));
    expect(merged.map((r) => r.version)).toEqual(["1.0.0", "0.9.0"]);
  });

  it("caps retained versions at REGISTRY_RETAINED_VERSIONS total (current + previous)", () => {
    const previous = ["1.4.0", "1.3.0", "1.2.0", "1.1.0"].map(ref);
    const merged = mergePreviousVersions(entry("1.5.0", previous), ref("1.6.0"));
    expect(merged).toHaveLength(REGISTRY_RETAINED_VERSIONS - 1);
    expect(merged.map((r) => r.version)).toEqual(["1.5.0", "1.4.0", "1.3.0", "1.2.0"]);
  });

  it("republishing the same version does not duplicate it in previousVersions", () => {
    const merged = mergePreviousVersions(entry("1.0.0", [ref("0.9.0")]), ref("1.0.0"));
    expect(merged.map((r) => r.version)).toEqual(["0.9.0"]);
  });

  it("first publish (no existing entry) has empty previousVersions", () => {
    expect(mergePreviousVersions(undefined, ref("1.0.0"))).toEqual([]);
  });
});

describe("packModuleArtifact", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("packs manifest + dist/** + sql/** with a schema-valid filename, sha256, and size", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-mod-"));
    const out = mkdtempSync(join(tmpdir(), "pack-out-"));
    dirs.push(dir, out);
    writeFileSync(join(dir, "jarvis.module.json"), "{}");
    mkdirSync(join(dir, "dist", "web"), { recursive: true });
    writeFileSync(join(dir, "dist", "worker.js"), "// worker");
    writeFileSync(join(dir, "dist", "web", "index.js"), "// web");
    mkdirSync(join(dir, "sql"));
    writeFileSync(join(dir, "sql", "0001_init.sql"), "CREATE TABLE app.job_search_x (id uuid);");
    writeFileSync(join(dir, "README.md"), "must NOT be packed");

    const packed = await packModuleArtifact(dir, out, "job-search", "1.0.0");
    expect(packed.artifact).toBe("job-search-1.0.0.tgz");
    expect(packed.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(packed.sizeBytes).toBeGreaterThan(0);

    const entries: string[] = [];
    await tar.t({
      file: join(out, packed.artifact),
      onReadEntry: (e) => {
        entries.push(String(e.path));
      }
    });
    const files = entries.filter((p) => !p.endsWith("/"));
    expect(files.sort()).toEqual([
      "dist/web/index.js",
      "dist/worker.js",
      "jarvis.module.json",
      "sql/0001_init.sql"
    ]);
  });

  it("packs a module without sql/ (metadata-only module)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-nosql-"));
    const out = mkdtempSync(join(tmpdir(), "pack-nosql-out-"));
    dirs.push(dir, out);
    writeFileSync(join(dir, "jarvis.module.json"), "{}");
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "worker.js"), "// worker");
    const packed = await packModuleArtifact(dir, out, "tiny", "0.1.0");
    expect(packed.artifact).toBe("tiny-0.1.0.tgz");
  });
});
