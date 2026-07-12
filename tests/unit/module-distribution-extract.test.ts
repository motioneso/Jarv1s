import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
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

  it("rejects a decompression bomb (extracted size > 4x tarball size)", async () => {
    // Highly compressible payload: 10 MiB of zeros gzips to ~10 KiB.
    const tarball = await craftTarball([
      { name: "dist/bomb.js", body: "\0".repeat(10 * 1024 * 1024) }
    ]);
    await expect(safeExtractModuleTarball(tarball, tmp("dest-"))).rejects.toThrow(
      ModuleTarballError
    );
  });
});
