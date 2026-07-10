import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ModuleAssetPathError,
  resolveModuleAssetPath
} from "../../packages/module-registry/src/external/web-assets.js";

const root = mkdtempSync(join(tmpdir(), "webassets-"));
const moduleDir = join(root, "pkg");
mkdirSync(join(moduleDir, "dist"), { recursive: true });
writeFileSync(join(moduleDir, "dist", "index.js"), "export default 1;\n");
writeFileSync(join(root, "outside-secret.js"), "// outside\n");
writeFileSync(join(moduleDir, ".env"), "X=1\n");
symlinkSync(join(root, "outside-secret.js"), join(moduleDir, "dist", "escape.js"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("resolveModuleAssetPath", () => {
  it("resolves a clean relative path with content type", () => {
    const asset = resolveModuleAssetPath(moduleDir, "dist/index.js");
    expect(asset.contentType).toBe("text/javascript; charset=utf-8");
  });
  const reject = (rel: string, reason: string) =>
    expect(() => resolveModuleAssetPath(moduleDir, rel)).toThrowError(
      expect.objectContaining({ name: "ModuleAssetPathError", reason }) as Error
    );
  it("rejects traversal segments", () => reject("../outside-secret.js", "traversal"));
  it("rejects absolute paths", () => reject("/etc/hostname", "absolute"));
  it("rejects backslashes", () => reject("dist\\index.js", "absolute"));
  it("rejects empty and dot segments", () => reject("dist/./index.js", "traversal"));
  it("rejects disallowed extensions", () => reject(".env", "unsupported-type"));
  it("rejects symlink escapes via realpath containment", () =>
    reject("dist/escape.js", "outside-package"));
  it("rejects missing files without leaking paths", () => {
    try {
      resolveModuleAssetPath(moduleDir, "dist/missing.js");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleAssetPathError);
      expect((error as Error).message).not.toContain(moduleDir);
    }
  });
});
