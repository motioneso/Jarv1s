// tests/unit/external-module-finance-bundle.test.ts
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildExternalModule } from "../../scripts/build-external-module.js";

// FIN-01 (#1146): worker-bundle hygiene for the finance module, mirroring the
// job-search bundle suite — but worker-only: FIN-01 declares no web surface,
// so the build must SKIP the web bundle (optional-entrypoint guard in
// scripts/build-external-module.ts) instead of throwing on the missing
// src/web/index.ts. The worker bundle must be self-contained CJS that boots
// under plain `node` in a bare temp dir (no node_modules), speaks worker
// contract v1, and answers -32601 handler_not_found for undeclared handlers.
const moduleDir = fileURLToPath(new URL("../../external-modules/finance", import.meta.url));

let bareDir: string;

beforeAll(async () => {
  await buildExternalModule(moduleDir);
  bareDir = mkdtempSync(join(tmpdir(), "finance-bare-"));
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
        // Minimal kv-answering parent: real handlers (Task 7 made all four
        // registry keys live) issue kv RPCs upward; an empty store keeps the
        // suite hermetic while proving the bridge round-trips in the bundle.
        if (message.method === "kv.list") {
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: [] })}\n`);
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

describe("finance bundle hygiene (#1146)", () => {
  it("worker-only module builds without emitting a web bundle", () => {
    // The optional-web guard must skip, not fail — and must not leave a stale
    // or empty dist/web behind that the manifest never declares.
    expect(existsSync(join(moduleDir, "dist/worker.js"))).toBe(true);
    expect(existsSync(join(moduleDir, "dist/web"))).toBe(false);
  });

  it("worker bundle boots without node_modules and reports contract v1", async () => {
    const messages = await runWorker([], (m) => m.method === "worker.ready");
    expect(messages.at(-1)).toMatchObject({ method: "worker.ready", params: { version: 1 } });
  });

  it("answers a declared handler through dispatch", async () => {
    // accounts.list is real as of Task 7 (#1146): dispatch, the wrap.ts
    // envelope, AND the kv RPC bridge must all survive bundling — the empty
    // store answer proves the full round trip.
    const messages = await runWorker(
      [
        {
          jsonrpc: "2.0",
          id: "t1",
          method: "module.invoke",
          params: { handler: "accounts.list", input: {} }
        }
      ],
      (m) => m.id === "t1"
    );
    expect(messages.at(-1)).toMatchObject({
      id: "t1",
      result: { accounts: [], nextStep: "connect a bank with finance.connect.start" }
    });
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

  it("no provider/model identifier anywhere in package source or built worker", () => {
    // Provider independence: the module requests capabilities via ctx.ai and
    // never names a vendor (job-search gate item 12 precedent). "plaid" is a
    // bank-data provider, not an AI provider — deliberately not in this list.
    const providerRe =
      /openai|anthropic|claude|gemini|gpt-|mistral|llama|sonnet|haiku|deepseek|bedrock|vertex/i;
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
      );
    const files = [...walk(join(moduleDir, "src")), join(moduleDir, "dist/worker.js")];
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(providerRe);
    }
  });
});
