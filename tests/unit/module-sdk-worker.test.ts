import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, expect, it } from "vitest";

const dirs: string[] = [];

afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true }))));

const workerImport = JSON.stringify(
  pathToFileURL(join(process.cwd(), "packages/module-sdk/src/worker.ts")).href
);

async function spawnWorker(body: string): Promise<{
  child: ChildProcess;
  next: () => Promise<Record<string, unknown>>;
}> {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-module-worker-"));
  dirs.push(dir);
  const entry = join(dir, "worker.mjs");
  await writeFile(entry, `import { defineModuleWorker } from ${workerImport};\n${body}`);
  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"]
  });
  const messages: unknown[] = [];
  let buffer = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      messages.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  const next = async () => {
    for (let attempt = 0; messages.length === 0 && attempt < 200; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (messages.length === 0) throw new Error("worker produced no protocol message");
    return messages.shift() as Record<string, unknown>;
  };
  return { child, next };
}

it("serves handlers and parent RPC through the worker contract", async () => {
  const { child, next } = await spawnWorker(
    `defineModuleWorker({ handlers: { lookup: async (ctx) => ({
  input: ctx.input,
  token: await ctx.auth.getCredential("acme.key"),
  fetched: await ctx.fetch({ url: "https://api.example.com/data" })
}) } });`
  );

  expect(await next()).toMatchObject({ method: "worker.ready", params: { version: 1 } });
  child.stdin?.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: "host:1", method: "module.invoke", params: { handler: "lookup", input: { q: 1 } } })}\n`
  );
  const credential = await next();
  expect(credential).toMatchObject({
    method: "auth.getCredential",
    params: { authId: "acme.key" }
  });
  child.stdin?.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: credential.id, result: "secret" })}\n`
  );
  const fetchRequest = await next();
  expect(fetchRequest).toMatchObject({
    method: "fetch.request",
    params: { url: "https://api.example.com/data" }
  });
  child.stdin?.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: fetchRequest.id, result: { status: 200, headers: { "content-type": "application/json" }, bodyBase64: "e30=" } })}\n`
  );
  expect(await next()).toMatchObject({
    id: "host:1",
    result: {
      input: { q: 1 },
      token: "secret",
      fetched: {
        status: 200,
        headers: { "content-type": "application/json" },
        bodyBase64: "e30="
      }
    }
  });
  child.kill();
});

it("bridges ctx.ai.generateStructured over parent RPC and returns the result verbatim", async () => {
  const { child, next } = await spawnWorker(
    `defineModuleWorker({ handlers: { critique: async (ctx) => ({
  ai: await ctx.ai.generateStructured({ schema: { type: "object" }, prompt: "p" })
}) } });`
  );

  expect(await next()).toMatchObject({ method: "worker.ready", params: { version: 1 } });
  child.stdin?.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: "host:2", method: "module.invoke", params: { handler: "critique", input: {} } })}\n`
  );
  const aiCall = await next();
  expect(aiCall).toMatchObject({
    method: "ai.generateStructured",
    params: { schema: { type: "object" }, prompt: "p" }
  });
  child.stdin?.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: aiCall.id, result: { ok: true, object: { summary: "s" } } })}\n`
  );
  expect(await next()).toMatchObject({
    id: "host:2",
    result: { ai: { ok: true, object: { summary: "s" } } }
  });
  child.kill();
});
