// tests/unit/external-module-job-search-bundle.test.ts
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildExternalModule } from "../../scripts/build-external-module.js";

// JS-01 (#930): the emitted artifacts must honor the two runtime contracts —
// browser bundle: ESM, no Node/server code, host React only; worker bundle:
// self-contained CJS that boots under plain `node` with no node_modules
// anywhere near it (a bare temp dir), speaks worker contract v1, and answers
// -32601 handler_not_found for undeclared handlers.
const moduleDir = fileURLToPath(new URL("../../external-modules/job-search", import.meta.url));

let bareDir: string;

beforeAll(async () => {
  await buildExternalModule(moduleDir);
  bareDir = mkdtempSync(join(tmpdir(), "job-search-bare-"));
  copyFileSync(join(moduleDir, "dist/worker.js"), join(bareDir, "worker.js"));
}, 60_000);

afterAll(() => {
  rmSync(bareDir, { recursive: true, force: true });
});

type Rpc = { method?: string; id?: string; params?: unknown; result?: unknown; error?: unknown };

// Boots the worker in the bare dir, collects JSON lines until `until` matches,
// then kills the child. Requests in `sends` go to stdin after worker.ready.
async function runWorker(sends: readonly object[], until: (m: Rpc) => boolean): Promise<Rpc[]> {
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

describe("job-search bundle hygiene (#930)", () => {
  it("web bundle is browser-only ESM using the host React runtime", () => {
    const source = readFileSync(join(moduleDir, "dist/web/index.js"), "utf8");
    expect(source).toContain("__JARVIS_MODULE_RUNTIME__");
    expect(source).toContain("export"); // ESM output
    expect(source).not.toContain("node:"); // no Node/server code
    expect(source).not.toContain("require("); // no CJS/react bundled in
    expect(source).not.toMatch(/react[./-]dom|react\.development|react\.production/);
  });

  it("worker bundle boots without node_modules and reports contract v1", async () => {
    const messages = await runWorker([], (m) => m.method === "worker.ready");
    expect(messages.at(-1)).toMatchObject({ method: "worker.ready", params: { version: 1 } });
  });

  it("answers a declared handler with not-implemented", async () => {
    // opportunities.list is a JS-05 stub; profile.get was implemented in JS-03
    // (it now issues kv RPCs to the parent, which this bare harness never answers).
    const messages = await runWorker(
      [
        {
          jsonrpc: "2.0",
          id: "t1",
          method: "module.invoke",
          params: { handler: "opportunities.list" }
        }
      ],
      (m) => m.id === "t1"
    );
    expect(messages.at(-1)).toMatchObject({ id: "t1", result: { status: "not-implemented" } });
  });

  it("answers an undeclared handler with -32601 handler_not_found", async () => {
    const messages = await runWorker(
      [{ jsonrpc: "2.0", id: "t2", method: "module.invoke", params: { handler: "nope" } }],
      (m) => m.id === "t2"
    );
    expect(messages.at(-1)).toMatchObject({
      id: "t2",
      error: { code: -32601, message: "handler_not_found" }
    });
  });
});
