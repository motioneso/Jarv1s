import { describe, expect, it } from "vitest";

import {
  ARTIFACT_MAX_BYTES,
  parseModulesEnsure,
  resolveRegistryArtifact,
  validateRegistryIndex,
  type ModuleRegistryIndex
} from "../../packages/module-registry/src/node.js";

const goodEntry = {
  id: "job-search",
  name: "Job Search",
  description: "Track job applications",
  version: "1.2.0",
  artifact: "job-search-1.2.0.tgz",
  sha256: "a".repeat(64),
  sizeBytes: 1024,
  requiresCore: ">=0.1.0",
  capabilities: { permissions: ["storage"], fetchHosts: [], tools: [], ownsTables: true },
  signature: null,
  previousVersions: [
    { version: "1.1.0", artifact: "job-search-1.1.0.tgz", sha256: "b".repeat(64), sizeBytes: 900 }
  ]
};

const goodIndex = {
  schemaVersion: 1,
  generatedAt: "2026-07-12T00:00:00.000Z",
  modules: [goodEntry]
};

describe("validateRegistryIndex", () => {
  it("accepts a well-formed index", () => {
    const result = validateRegistryIndex(goodIndex);
    expect(result.errors).toEqual([]);
    expect(result.index?.modules).toHaveLength(1);
    expect(result.index?.modules[0]?.id).toBe("job-search");
    expect(result.index?.modules[0]?.previousVersions).toHaveLength(1);
  });

  it("tolerates unknown fields at every level (forward compat)", () => {
    const raw = {
      ...goodIndex,
      futureTopLevel: true,
      modules: [
        {
          ...goodEntry,
          futureField: "x",
          capabilities: { ...goodEntry.capabilities, futureCap: 1 }
        }
      ]
    };
    const result = validateRegistryIndex(raw);
    expect(result.index?.modules).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it("fails closed on a bad envelope", () => {
    for (const raw of [
      null,
      [],
      "x",
      { schemaVersion: 2, generatedAt: "t", modules: [] },
      { schemaVersion: 1, modules: [] },
      { schemaVersion: 1, generatedAt: "t", modules: {} }
    ]) {
      const result = validateRegistryIndex(raw);
      expect(result.index).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("drops malformed entries but keeps valid ones", () => {
    const raw = {
      ...goodIndex,
      modules: [
        goodEntry,
        { ...goodEntry, id: "Bad.Id" },
        { ...goodEntry, id: "no-artifact", artifact: "https://evil.example/x.tgz" },
        { ...goodEntry, id: "bad-sha", sha256: "zz" },
        { ...goodEntry, id: "too-big", sizeBytes: ARTIFACT_MAX_BYTES + 1 },
        { ...goodEntry, id: "no-prev", previousVersions: undefined },
        { ...goodEntry, id: "bad-prev", previousVersions: [{ version: "1.0.0" }] }
      ]
    };
    const result = validateRegistryIndex(raw);
    expect(result.index?.modules.map((m) => m.id)).toEqual(["job-search"]);
    expect(result.errors).toHaveLength(6);
  });

  it("rejects artifact filenames with path separators or traversal", () => {
    for (const artifact of ["../x.tgz", "a/b.tgz", "x.tar.gz.exe", ".hidden.tgz", "UPPER.tgz"]) {
      const result = validateRegistryIndex({ ...goodIndex, modules: [{ ...goodEntry, artifact }] });
      expect(result.index?.modules).toEqual([]);
    }
  });

  it("rejects duplicate module ids (both dropped is wrong — first wins, second errored)", () => {
    const result = validateRegistryIndex({
      ...goodIndex,
      modules: [goodEntry, { ...goodEntry, version: "9.9.9" }]
    });
    expect(result.index?.modules).toHaveLength(1);
    expect(result.index?.modules[0]?.version).toBe("1.2.0");
    expect(result.errors).toHaveLength(1);
  });
});

describe("resolveRegistryArtifact", () => {
  const index = validateRegistryIndex(goodIndex).index as ModuleRegistryIndex;

  it("resolves the current version when no pin is given", () => {
    const hit = resolveRegistryArtifact(index, "job-search");
    expect(hit?.ref.version).toBe("1.2.0");
    expect(hit?.entry.id).toBe("job-search");
  });

  it("resolves a pinned previous version", () => {
    expect(resolveRegistryArtifact(index, "job-search", "1.1.0")?.ref.artifact).toBe(
      "job-search-1.1.0.tgz"
    );
  });

  it("returns null for unknown module or unknown version", () => {
    expect(resolveRegistryArtifact(index, "nope")).toBeNull();
    expect(resolveRegistryArtifact(index, "job-search", "0.0.1")).toBeNull();
  });
});

describe("parseModulesEnsure", () => {
  it("parses comma/whitespace separated ids with optional @version pins", () => {
    const result = parseModulesEnsure("job-search, weather-plus@1.1.0\n  notes-extra");
    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual([
      { id: "job-search" },
      { id: "weather-plus", version: "1.1.0" },
      { id: "notes-extra" }
    ]);
  });

  it("returns empty for unset/blank input", () => {
    expect(parseModulesEnsure(undefined).entries).toEqual([]);
    expect(parseModulesEnsure("").entries).toEqual([]);
    expect(parseModulesEnsure("  ").entries).toEqual([]);
  });

  it("collects errors for bad ids and duplicate ids (first wins)", () => {
    const result = parseModulesEnsure("Bad.Id, job-search@1.0.0, job-search@2.0.0, @1.0.0");
    expect(result.entries).toEqual([{ id: "job-search", version: "1.0.0" }]);
    expect(result.errors).toHaveLength(3);
  });
});
