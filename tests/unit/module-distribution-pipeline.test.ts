import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as tar from "tar";
import { afterAll, describe, expect, it } from "vitest";

import {
  downloadAndStageModule,
  fetchRegistryIndex,
  REGISTRY_INDEX_URL,
  resolveRegistryIndexUrl,
  type ModuleRegistryIndex
} from "../../packages/module-registry/src/node.js";

const dirs: string[] = [];
const tmp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const manifest = {
  schemaVersion: 1,
  id: "job-search",
  name: "Job Search",
  version: "1.2.0",
  publisher: "Jarvis Labs",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" }
};

/** Build a real module tarball and the index entry pointing at it. */
async function makeFixture(overrides?: { manifestVersion?: string }): Promise<{
  index: ModuleRegistryIndex;
  tarballBytes: Buffer;
}> {
  const src = tmp("pipe-src-");
  writeFileSync(
    join(src, "jarvis.module.json"),
    JSON.stringify({ ...manifest, version: overrides?.manifestVersion ?? manifest.version })
  );
  mkdirSync(join(src, "dist"));
  writeFileSync(join(src, "dist", "worker.js"), "// w");
  const tarball = join(tmp("pipe-tar-"), "job-search-1.2.0.tgz");
  await tar.create({ gzip: true, portable: true, cwd: src, file: tarball }, [
    "jarvis.module.json",
    "dist"
  ]);
  const tarballBytes = readFileSync(tarball);
  return {
    tarballBytes,
    index: {
      schemaVersion: 1,
      generatedAt: "2026-07-12T00:00:00.000Z",
      modules: [
        {
          id: "job-search",
          name: "Job Search",
          description: null,
          version: "1.2.0",
          artifact: "job-search-1.2.0.tgz",
          sha256: createHash("sha256").update(tarballBytes).digest("hex"),
          sizeBytes: tarballBytes.length,
          requiresCore: ">=0.0.0",
          capabilities: { permissions: [], fetchHosts: [], tools: [], ownsTables: [] },
          previousVersions: []
        }
      ]
    }
  };
}

/** Fake fetch serving the index and the tarball, standing in for the release URL. */
const fakeFetch =
  (index: ModuleRegistryIndex, tarballBytes: Buffer): typeof fetch =>
  async (input) => {
    const url = String(input);
    if (url.endsWith("/index.json")) return new Response(JSON.stringify(index), { status: 200 });
    if (url.endsWith(".tgz")) return new Response(new Uint8Array(tarballBytes), { status: 200 });
    return new Response("not found", { status: 404 });
  };

describe("resolveRegistryIndexUrl (#964)", () => {
  it("defaults to the pinned release URL", () => {
    expect(resolveRegistryIndexUrl({} as NodeJS.ProcessEnv)).toBe(REGISTRY_INDEX_URL);
  });
  it("honors JARVIS_MODULE_REGISTRY_URL outside production", () => {
    const env = {
      JARVIS_MODULE_REGISTRY_URL: "http://127.0.0.1:9/index.json"
    } as NodeJS.ProcessEnv;
    expect(resolveRegistryIndexUrl(env)).toBe("http://127.0.0.1:9/index.json");
  });
  it("REFUSES the override in production", () => {
    const env = {
      NODE_ENV: "production",
      JARVIS_MODULE_REGISTRY_URL: "http://127.0.0.1:9/index.json"
    } as NodeJS.ProcessEnv;
    expect(() => resolveRegistryIndexUrl(env)).toThrow(/test-only/);
  });
});

describe("fetchRegistryIndex (#964)", () => {
  it("returns the validated index", async () => {
    const { index, tarballBytes } = await makeFixture();
    const result = await fetchRegistryIndex({
      env: {} as NodeJS.ProcessEnv,
      fetchFn: fakeFetch(index, tarballBytes)
    });
    expect(result.index?.modules[0]?.id).toBe("job-search");
  });
  it("fails closed on an oversized index", async () => {
    const big: typeof fetch = async () =>
      new Response("x".repeat(1024 * 1024 + 1), { status: 200 });
    const result = await fetchRegistryIndex({ env: {} as NodeJS.ProcessEnv, fetchFn: big });
    expect(result.index).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
  it("fails closed on a non-200 response", async () => {
    const nope: typeof fetch = async () => new Response("gone", { status: 404 });
    const result = await fetchRegistryIndex({ env: {} as NodeJS.ProcessEnv, fetchFn: nope });
    expect(result.index).toBeNull();
  });
});

describe("downloadAndStageModule (#964)", () => {
  it("stages a verified module and returns its package hash", async () => {
    const { index, tarballBytes } = await makeFixture();
    const modulesDir = tmp("pipe-mods-");
    const result = await downloadAndStageModule({
      moduleId: "job-search",
      modulesDir,
      env: {} as NodeJS.ProcessEnv,
      fetchFn: fakeFetch(index, tarballBytes)
    });
    expect(result.version).toBe("1.2.0");
    expect(result.packageHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(existsSync(join(modulesDir, "job-search", "jarvis.module.json"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(modulesDir, "job-search", "package.json"), "utf8"))
    ).toEqual({ type: "commonjs" });
    expect(existsSync(join(modulesDir, ".staging-job-search"))).toBe(false);
  });

  it("rejects on sha256 mismatch without touching the modules dir", async () => {
    const { index, tarballBytes } = await makeFixture();
    const tampered = {
      ...index,
      modules: [{ ...index.modules[0]!, sha256: "b".repeat(64) }]
    };
    const modulesDir = tmp("pipe-mods-");
    await expect(
      downloadAndStageModule({
        moduleId: "job-search",
        modulesDir,
        env: {} as NodeJS.ProcessEnv,
        fetchFn: fakeFetch(tampered, tarballBytes)
      })
    ).rejects.toMatchObject({ code: "integrity-mismatch" });
    expect(existsSync(join(modulesDir, "job-search"))).toBe(false);
  });

  it("rejects when the inner manifest version disagrees with the index", async () => {
    const { tarballBytes } = await makeFixture({ manifestVersion: "9.9.9" });
    // Index advertises 1.2.0 but must carry the REAL sha/size of the 9.9.9 tarball so
    // integrity passes and the version check is what trips.
    const { index } = await makeFixture();
    const lying = {
      ...index,
      modules: [
        {
          ...index.modules[0]!,
          sha256: createHash("sha256").update(tarballBytes).digest("hex"),
          sizeBytes: tarballBytes.length
        }
      ]
    };
    await expect(
      downloadAndStageModule({
        moduleId: "job-search",
        modulesDir: tmp("pipe-mods-"),
        env: {} as NodeJS.ProcessEnv,
        fetchFn: fakeFetch(lying, tarballBytes)
      })
    ).rejects.toMatchObject({ code: "version-mismatch" });
  });

  it("rejects an unknown module id", async () => {
    const { index, tarballBytes } = await makeFixture();
    await expect(
      downloadAndStageModule({
        moduleId: "nope",
        modulesDir: tmp("pipe-mods-"),
        env: {} as NodeJS.ProcessEnv,
        fetchFn: fakeFetch(index, tarballBytes)
      })
    ).rejects.toMatchObject({ code: "module-not-found" });
  });
});
