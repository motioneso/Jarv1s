import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import * as tar from "tar";
import { pack } from "tar-stream";
import { afterAll, describe, expect, it } from "vitest";

import {
  EXTRACT_MIN_ABSOLUTE,
  ModuleTarballError,
  safeExtractModuleTarball
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

/** Craft an arbitrary (potentially malicious) .tgz with tar-stream. */
async function craftTarball(
  entries: readonly {
    name: string;
    type?: "file" | "symlink" | "link";
    linkname?: string;
    body?: string;
  }[]
): Promise<string> {
  const dir = tmp("craft-");
  const file = join(dir, "crafted.tgz");
  const p = pack();
  for (const e of entries) {
    if (e.type === "symlink" || e.type === "link") {
      p.entry({ name: e.name, type: e.type, linkname: e.linkname ?? "/etc/passwd" });
    } else {
      p.entry({ name: e.name }, e.body ?? "x");
    }
  }
  p.finalize();
  await pipeline(p, createGzip(), createWriteStream(file));
  return file;
}

describe("safeExtractModuleTarball (#964)", () => {
  it("extracts a legitimate module tarball", async () => {
    const src = tmp("legit-src-");
    writeFileSync(join(src, "jarvis.module.json"), "{}");
    mkdirSync(join(src, "dist"));
    writeFileSync(join(src, "dist", "worker.js"), "// w");
    const tarball = join(tmp("legit-tar-"), "mod.tgz");
    await tar.create({ gzip: true, portable: true, cwd: src, file: tarball }, [
      "jarvis.module.json",
      "dist"
    ]);
    const dest = tmp("legit-dest-");
    await safeExtractModuleTarball(tarball, dest);
    expect(readdirSync(dest).sort()).toEqual(["dist", "jarvis.module.json"]);
  });

  it("rejects path traversal and absolute paths", async () => {
    for (const name of ["../evil.js", "dist/../../evil.js", "/etc/cron.d/evil"]) {
      const tarball = await craftTarball([{ name }]);
      await expect(safeExtractModuleTarball(tarball, tmp("dest-"))).rejects.toThrow(
        ModuleTarballError
      );
    }
  });

  it("rejects symlink and hardlink entries", async () => {
    for (const type of ["symlink", "link"] as const) {
      const tarball = await craftTarball([{ name: "dist/worker.js", type }]);
      await expect(safeExtractModuleTarball(tarball, tmp("dest-"))).rejects.toThrow(
        ModuleTarballError
      );
    }
  });

  it("rejects tarballs with too many entries", async () => {
    const entries = Array.from({ length: 2001 }, (_, i) => ({ name: `dist/f${i}.js` }));
    const tarball = await craftTarball(entries);
    await expect(safeExtractModuleTarball(tarball, tmp("dest-"))).rejects.toThrow(
      ModuleTarballError
    );
  });

  it("rejects a decompression bomb (extracted size exceeds ratio and floor caps)", async () => {
    // Highly compressible payload: 10 MiB of zeros gzips to ~10 KiB, so the ratio cap
    // (~100 KiB) is dwarfed by 10 MiB — still well over the 4 MiB absolute floor too (#999).
    const tarball = await craftTarball([
      { name: "dist/bomb.js", body: "\0".repeat(10 * 1024 * 1024) }
    ]);
    await expect(safeExtractModuleTarball(tarball, tmp("dest-"))).rejects.toThrow(
      ModuleTarballError
    );
  });

  it("#999: extracts a legitimate module whose ratio exceeds the old 4x cap", async () => {
    // Mirrors the real job-search 0.1.0 regression: a small tarball whose gzip ratio is >4x
    // (would have been rejected pre-#999) but whose total extracted size is comfortably under
    // the new EXTRACT_MIN_ABSOLUTE floor, so it now installs successfully.
    const lines = Array.from(
      { length: 3000 },
      (_, i) => `export const value_${i} = ${i} + ${i * 2}; // comment for entry ${i}`
    ).join("\n");
    const tarball = await craftTarball([{ name: "dist/worker.js", body: lines }]);
    const tarballSize = statSync(tarball).size;
    expect(lines.length).toBeGreaterThan(4 * tarballSize);
    const dest = tmp("dest-");
    await safeExtractModuleTarball(tarball, dest);
    expect(readdirSync(dest)).toEqual(["dist"]);
  });

  it("#999: still rejects a tiny tarball that exceeds the new absolute floor", async () => {
    // Proves the floor -- not just the ratio -- still bounds a bomb: a highly compressible
    // payload just over EXTRACT_MIN_ABSOLUTE (4 MiB) gzips to a tiny tarball, so the ratio cap
    // alone (tarballSize * 10) would be minuscule, but the floor still catches it.
    const tarball = await craftTarball([
      { name: "dist/bomb.js", body: "\0".repeat(EXTRACT_MIN_ABSOLUTE + 1024) }
    ]);
    const tarballSize = statSync(tarball).size;
    expect(tarballSize * 10).toBeLessThan(EXTRACT_MIN_ABSOLUTE);
    await expect(safeExtractModuleTarball(tarball, tmp("dest-"))).rejects.toThrow(
      ModuleTarballError
    );
  });
});
