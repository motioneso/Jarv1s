import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashCanonicalManifest, hashExternalPackage } from "@jarv1s/module-registry/node";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "extmod-hash-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("hashCanonicalManifest (#917)", () => {
  it("is stable regardless of key order", () => {
    const a = hashCanonicalManifest({
      id: "m",
      name: "M",
      version: "0.1.0",
      publisher: "P",
      lifecycle: "optional",
      compatibility: { jarv1s: "*" }
    });
    const b = hashCanonicalManifest({
      compatibility: { jarv1s: "*" },
      publisher: "P",
      lifecycle: "optional",
      version: "0.1.0",
      name: "M",
      id: "m"
    } as never);
    expect(a).toBe(b);
    expect(a.startsWith("sha256:")).toBe(true);
  });
});

describe("hashExternalPackage (#917)", () => {
  it("changes when a dist file changes", () => {
    writeFileSync(join(dir, "jarvis.module.json"), '{"id":"m"}');
    mkdirSync(join(dir, "dist", "web"), { recursive: true });
    writeFileSync(join(dir, "dist", "worker.js"), "export const a = 1;");
    writeFileSync(join(dir, "dist", "web", "index.js"), "export const b = 1;");
    const before = hashExternalPackage(dir);

    writeFileSync(join(dir, "dist", "worker.js"), "export const a = 2;");
    const after = hashExternalPackage(dir);

    expect(before).not.toBe(after);
    expect(before.startsWith("sha256:")).toBe(true);
  });

  it("is stable across repeated calls with no changes", () => {
    writeFileSync(join(dir, "jarvis.module.json"), '{"id":"m"}');
    expect(hashExternalPackage(dir)).toBe(hashExternalPackage(dir));
  });

  it("changes when the worker module type changes", () => {
    writeFileSync(join(dir, "jarvis.module.json"), '{"id":"m"}');
    writeFileSync(join(dir, "package.json"), '{"type":"commonjs"}');
    const before = hashExternalPackage(dir);

    writeFileSync(join(dir, "package.json"), '{"type":"module"}');

    expect(hashExternalPackage(dir)).not.toBe(before);
  });
});
