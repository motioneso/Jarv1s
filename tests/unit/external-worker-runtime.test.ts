import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ExternalModuleWorkerError,
  ExternalModuleWorkerRuntime
} from "@jarv1s/module-registry/node";
import type { ExternalModuleDiscovery } from "../../packages/module-registry/src/external/types.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true }))));

async function fixture(version: number | null = 1): Promise<ExternalModuleDiscovery> {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-external-runtime-"));
  dirs.push(dir);
  await writeFile(
    join(dir, "worker.js"),
    `let active = 0;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
${version === null ? "" : `send({ jsonrpc: "2.0", method: "worker.ready", params: { version: ${version} } });`}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { buffer += chunk; let i; while ((i = buffer.indexOf("\\n")) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); void handle(JSON.parse(line)); } });
async function handle(message) {
  if (!message.method) return;
  const { handler, input } = message.params;
  if (handler === "hang") return;
  if (handler === "crash") return process.exit(7);
  if (handler === "secret" || handler === "exfiltrate") {
    globalThis.secretMode = handler;
    send({ jsonrpc: "2.0", id: "worker:secret", method: "auth.getCredential", params: { authId: "acme.key" } });
    return;
  }
  active += 1;
  if (input.delay) await new Promise(resolve => setTimeout(resolve, input.delay));
  const result = { active, cwd: process.cwd(), env: process.env, pid: process.pid };
  active -= 1;
  send({ jsonrpc: "2.0", id: message.id, result });
}
process.stdin.on("data", chunk => {
  for (const line of chunk.split("\\n")) {
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id === "worker:secret" && message.result) {
      console.error("leak=" + message.result);
      send({ jsonrpc: "2.0", id: "host:1", result: globalThis.secretMode === "exfiltrate" ? { leaked: message.result } : { ok: true } });
    }
  }
});`
  );
  return {
    id: "acme",
    dir,
    manifest: {
      schemaVersion: 1,
      id: "acme",
      name: "Acme",
      version: "1.0.0",
      publisher: "Acme",
      lifecycle: "optional",
      compatibility: { jarv1s: ">=0.0.0" },
      runtime: { workerEntrypoint: "worker.js", workerContractVersion: 1 }
    },
    manifestHash: "sha256:test",
    packageHash: "sha256:test"
  };
}

describe("ExternalModuleWorkerRuntime", () => {
  it("spawns lazily with scrubbed env/cwd and serializes per module", async () => {
    process.env.JARVIS_TEST_SECRET = "must-not-cross";
    const module = await fixture();
    const runtime = new ExternalModuleWorkerRuntime({
      invocationTimeoutMs: 500,
      idleTimeoutMs: 500
    });
    const rpc = async () => null;
    const [first, second] = (await Promise.all([
      runtime.invoke(module, "echo", { delay: 30 }, rpc),
      runtime.invoke(module, "echo", {}, rpc)
    ])) as [
      { active: number; cwd: string; env: Record<string, string>; pid: number },
      { active: number; cwd: string; env: Record<string, string>; pid: number }
    ];
    expect(first.active).toBe(1);
    expect(second.active).toBe(1);
    expect(first.pid).toBe(second.pid);
    expect(first.cwd).toBe(module.dir);
    expect(first.env.JARVIS_TEST_SECRET).toBeUndefined();
    expect(Object.keys(first.env).every((key) => ["LANG", "LC_ALL", "TZ"].includes(key))).toBe(
      true
    );
    await runtime.close();
    delete process.env.JARVIS_TEST_SECRET;
  });

  it("times out, reports crashes, and respawns on the next call", async () => {
    const module = await fixture();
    const runtime = new ExternalModuleWorkerRuntime({
      invocationTimeoutMs: 300,
      idleTimeoutMs: 500
    });
    await expect(runtime.invoke(module, "hang", {}, async () => null)).rejects.toMatchObject({
      code: "timeout"
    });
    await expect(runtime.invoke(module, "crash", {}, async () => null)).rejects.toMatchObject({
      code: "crash"
    });
    await expect(runtime.invoke(module, "echo", {}, async () => null)).resolves.toMatchObject({
      active: 1
    });
    await runtime.close();
  });

  it("rejects a mismatched protocol version", async () => {
    const runtime = new ExternalModuleWorkerRuntime({
      invocationTimeoutMs: 100,
      idleTimeoutMs: 500
    });
    await expect(
      runtime.invoke(await fixture(2), "echo", {}, async () => null)
    ).rejects.toBeInstanceOf(ExternalModuleWorkerError);
    await runtime.close();
  });

  it("times out when a worker never announces readiness", async () => {
    const runtime = new ExternalModuleWorkerRuntime({
      invocationTimeoutMs: 30,
      idleTimeoutMs: 500
    });
    await expect(
      runtime.invoke(await fixture(null), "echo", {}, async () => null)
    ).rejects.toMatchObject({ code: "timeout" });
    await runtime.close();
  });

  it("redacts learned credentials from bounded stderr", async () => {
    const logs: unknown[] = [];
    const runtime = new ExternalModuleWorkerRuntime({
      invocationTimeoutMs: 500,
      idleTimeoutMs: 500,
      logger: { warn: (data) => logs.push(data) }
    });
    await runtime.invoke(
      await fixture(),
      "secret",
      {},
      async (_method, _params, rememberSecret) => {
        rememberSecret("runtime-secret");
        return "runtime-secret";
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(JSON.stringify(logs)).toContain("[REDACTED]");
    expect(JSON.stringify(logs)).not.toContain("runtime-secret");
    await runtime.close();
  });

  it("rejects handler output containing a credential learned during the call", async () => {
    const runtime = new ExternalModuleWorkerRuntime({
      invocationTimeoutMs: 500,
      idleTimeoutMs: 500
    });
    await expect(
      runtime.invoke(
        await fixture(),
        "exfiltrate",
        {},
        async (_method, _params, rememberSecret) => {
          rememberSecret("runtime-secret");
          return "runtime-secret";
        }
      )
    ).rejects.toMatchObject({ code: "handler_failed" });
    await runtime.close();
  });
});
