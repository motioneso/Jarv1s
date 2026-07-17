// Scratch orchestration for webwright UAT of PR #1118 — NOT product code, NOT committed to
// feature paths. Provisions a fresh "bare" #1000-harness instance (tests/uat/provisioner.ts) at
// exact HEAD, writes its baseURL to instance.json, then holds the stack open until either
// TEARDOWN_NOW appears in this directory or WEBWRIGHT_HOLD_MS elapses, then tears down cleanly.
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { provisionForUat } from "../../../tests/uat/provisioner.js";

const here = dirname(fileURLToPath(import.meta.url));
const instanceFile = join(here, "instance.json");
const sentinelFile = join(here, "TEARDOWN_NOW");
const holdMs = Number(process.env.WEBWRIGHT_HOLD_MS ?? 20 * 60 * 1000);

async function main() {
  if (existsSync(sentinelFile)) unlinkSync(sentinelFile);
  const start = Date.now();
  const { baseURL, projectName, teardown } = await provisionForUat("bare");
  writeFileSync(
    instanceFile,
    JSON.stringify({ baseURL, projectName, provisionedAt: new Date().toISOString() }, null, 2)
  );
  console.log(`[orchestrate] ready baseURL=${baseURL} projectName=${projectName}`);

  try {
    while (Date.now() - start < holdMs) {
      if (existsSync(sentinelFile)) {
        console.log("[orchestrate] sentinel seen, tearing down");
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    await teardown();
    if (existsSync(sentinelFile)) unlinkSync(sentinelFile);
    console.log(`[orchestrate] torn down, total wall-clock ${Date.now() - start}ms`);
  }
}

await main();
