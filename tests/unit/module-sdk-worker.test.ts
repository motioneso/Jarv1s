import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, expect, it } from "vitest";

const dirs: string[] = [];

afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true }))));

it("serves handlers and parent RPC through the worker contract", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-module-worker-"));
  dirs.push(dir);
  const entry = join(dir, "worker.mjs");
  await writeFile(
    entry,
    `import { defineModuleWorker } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/module-sdk/src/worker.ts")).href)};
defineModuleWorker({ handlers: { lookup: async (ctx) => ({
  input: ctx.input,
  token: await ctx.auth.getCredential("acme.key"),
  fetched: await ctx.fetch({ url: "https://api.example.com/data" })
}) } });`
  );
  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"]
  });
  const messages: unknown[] = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
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

  expect(await next()).toMatchObject({ method: "worker.ready", params: { version: 1 } });
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: "host:1", method: "module.invoke", params: { handler: "lookup", input: { q: 1 } } })}\n`
  );
  const credential = await next();
  expect(credential).toMatchObject({
    method: "auth.getCredential",
    params: { authId: "acme.key" }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: credential.id, result: "secret" })}\n`);
  const fetchRequest = await next();
  expect(fetchRequest).toMatchObject({
    method: "fetch.request",
    params: { url: "https://api.example.com/data" }
  });
  child.stdin.write(
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
