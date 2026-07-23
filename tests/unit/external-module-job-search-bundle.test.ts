import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildExternalModule } from "../../scripts/build-external-module.js";

const moduleDir = fileURLToPath(new URL("../../external-modules/job-search", import.meta.url));
let bareDir: string;

beforeAll(async () => {
  await buildExternalModule(moduleDir);
  bareDir = mkdtempSync(join(tmpdir(), "job-search-bare-"));
  copyFileSync(join(moduleDir, "dist/worker.js"), join(bareDir, "worker.js"));
}, 60_000);

afterAll(() => {
  if (bareDir) rmSync(bareDir, { recursive: true, force: true });
});

type Rpc = { method?: string; id?: string; params?: unknown; error?: unknown };

async function runWorker(
  sends: readonly object[],
  until: (message: Rpc) => boolean
): Promise<Rpc[]> {
  const child = spawn(process.execPath, ["worker.js"], { cwd: bareDir, stdio: "pipe" });
  const seen: Rpc[] = [];
  try {
    return await new Promise<Rpc[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker timed out")), 15_000);
      child.on("error", reject);
      createInterface({ input: child.stdout }).on("line", (line) => {
        const message = JSON.parse(line) as Rpc;
        seen.push(message);
        if (message.method === "worker.ready") {
          for (const send of sends) child.stdin.write(`${JSON.stringify(send)}\n`);
        }
        if (until(message)) {
          clearTimeout(timer);
          resolve(seen);
        }
      });
    });
  } finally {
    child.kill();
  }
}

describe("Job Search bundle contract (#1232)", () => {
  it("ships a browser ESM web bundle with host React and no runtime leaks", () => {
    const source = readFileSync(join(moduleDir, "dist/web/index.js"), "utf8");
    expect(source).toContain("__JARVIS_MODULE_RUNTIME__");
    expect(source).toContain("export");
    expect(source).not.toContain("node:");
    expect(source).not.toContain("require(");
    expect(source).not.toMatch(/@jarv1s\//);
    expect(source).not.toMatch(/react[./-]dom|react\.development|react\.production/);
  });

  it("ships a self-contained CJS worker that boots without node_modules", async () => {
    const source = readFileSync(join(moduleDir, "dist/worker.js"), "utf8");
    expect(source).toContain('"use strict"');
    expect(source).not.toMatch(/from\s+["']@jarv1s\//);
    const messages = await runWorker([], (message) => message.method === "worker.ready");
    expect(messages.at(-1)).toMatchObject({ method: "worker.ready", params: { version: 1 } });
  });

  it("returns the protocol error for an undeclared handler", async () => {
    const messages = await runWorker(
      [{ jsonrpc: "2.0", id: "missing", method: "module.invoke", params: { handler: "nope" } }],
      (message) => message.id === "missing"
    );
    expect(messages.at(-1)).toMatchObject({
      id: "missing",
      error: { code: -32601, message: "handler_not_found" }
    });
  });

  it("keeps Job Search outside the core image and built-in registry", () => {
    expect(readFileSync(".dockerignore", "utf8")).toContain("external-modules");
    expect(readFileSync("packages/module-registry/src/index.ts", "utf8")).not.toContain(
      'id: "job-search"'
    );
  });
});
