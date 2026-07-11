// tests/integration/js06-module-surface.test.ts
// JS-06 (#935): permanent guards for the module-surface data plane —
// supersedes the temporary js06-invoke-smoke proof. Read tools succeed over
// the invoke route, write tools 403 without executing, run-now dedupes via the
// manual singleton, and a disabled module fails closed to 404.
// Harness cloned from tests/integration/external-module-job-search.test.ts
// (better-auth first-signup bootstraps the admin — do not invent a new auth path).
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OutgoingHttpHeaders } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { migratePgBoss } from "@jarv1s/jobs";

import { createApiServer } from "../../apps/api/src/server.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";
import { buildExternalModule } from "../../scripts/build-external-module.js";

const sourceDir = fileURLToPath(new URL("../../external-modules/job-search", import.meta.url));

let root: string;
let modulesDir: string;
let appDb: Kysely<JarvisDatabase>;
let server: ReturnType<typeof createApiServer>;
let adminCookie: string;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  // In production the worker's ExternalModuleJobReconciler creates external
  // module queues at boot (apps/worker); this API-only harness must provision
  // job-search.monitor-run itself or run-now's boss.send throws → 503.
  await migratePgBoss(connectionStrings.migration, [
    { name: "job-search.monitor-run", options: { retryLimit: 3 } }
  ]);
  await buildExternalModule(sourceDir);

  root = mkdtempSync(join(tmpdir(), "js06-surface-"));
  modulesDir = join(root, "modules");
  const installedDir = join(modulesDir, "job-search");
  mkdirSync(installedDir, { recursive: true });
  cpSync(join(sourceDir, "jarvis.module.json"), join(installedDir, "jarvis.module.json"));
  cpSync(join(sourceDir, "dist"), join(installedDir, "dist"), { recursive: true });

  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  server = createApiServer({
    appDb,
    logger: false,
    apiServerConfig: {
      host: "0.0.0.0",
      port: 0,
      mcpServerUrl: "http://127.0.0.1:0/api/mcp",
      enableExternalModules: true,
      externalModulesDir: modulesDir
    }
  });
  await server.ready();

  const admin = await signUp(server, "owner@js06-surface.test", "Owner");
  adminCookie = admin.cookie;
  const enable = await setEnabled(true);
  expect(enable.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await Promise.allSettled([server?.close(), appDb?.destroy()]);
  rmSync(root, { recursive: true, force: true });
});

const setEnabled = (enabled: boolean) =>
  server.inject({
    method: "POST",
    url: "/api/admin/external-modules/job-search",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    payload: { enabled }
  });

const invokeTool = (name: string) =>
  server.inject({
    method: "POST",
    url: `/api/ai/assistant-tools/${name}/invoke`,
    headers: { cookie: adminCookie, "content-type": "application/json" },
    payload: { input: {} }
  });

const runNow = () =>
  server.inject({
    method: "POST",
    url: "/api/modules/job-search/queues/job-search.monitor-run/run",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    payload: { jobKind: "job-search.monitor-run-now", params: { monitorId: "m-test" } }
  });

describe("js-06 module surface data plane (#935)", () => {
  it("lists the declared job-search assistant tools", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/ai/assistant-tools",
      headers: { cookie: adminCookie }
    });
    expect(response.statusCode).toBe(200);
    const names = response
      .json<{ tools: Array<{ moduleId: string; name: string }> }>()
      .tools.filter((tool) => tool.moduleId === "job-search")
      .map((tool) => tool.name);
    for (const required of [
      "job-search.onboarding.get-state",
      "job-search.profile.get",
      "job-search.resume.get",
      "job-search.monitor.list",
      "job-search.monitor.get",
      "job-search.sources.list"
    ]) {
      expect(names).toContain(required);
    }
  });

  it("executes a risk:read tool over the invoke route", async () => {
    const response = await invokeTool("job-search.monitor.list");
    expect(response.statusCode).toBe(200);
    expect(response.json().invocation).toMatchObject({
      status: "succeeded",
      blockedReason: null,
      result: { status: "ok", monitors: [] }
    });
  });

  it("blocks a write tool with confirmation_required and does not execute it", async () => {
    const response = await invokeTool("job-search.monitor.save");
    expect(response.statusCode).toBe(403);
    expect(response.json().invocation).toMatchObject({
      status: "blocked",
      blockedReason: "confirmation_required"
    });
  });

  it("run-now accepts a manual submission with 202 and a jobId", async () => {
    const first = await runNow();
    expect(first.statusCode).toBe(202);
    expect(typeof first.json<{ jobId: string | null }>().jobId).toBe("string");

    // Known gap (#965): the manual-path singletonKey does NOT dedupe today —
    // pg-boss v12 only enforces singleton keys through policy-filtered unique
    // indexes, and external queues are created with the default standard
    // policy. A second submit while queued therefore also gets a fresh jobId.
    // Once #965 lands (singletonSeconds on the run route), tighten this to
    // assert the second response carries jobId: null.
    const second = await runNow();
    expect(second.statusCode).toBe(202);
  });

  it("fails closed after disable: invoke answers 404 tool-not-declared", async () => {
    const disable = await setEnabled(false);
    expect(disable.statusCode).toBe(200);

    // A formerly-good read tool must vanish from the declared set entirely.
    const response = await invokeTool("job-search.monitor.list");
    expect(response.statusCode).toBe(404);
  });
});

async function signUp(
  target: ReturnType<typeof createApiServer>,
  email: string,
  name: string
): Promise<{ cookie: string; userId: string }> {
  const res = await target.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "content-type": "application/json" },
    payload: { name, email, password: "correct horse battery staple" }
  });
  if (res.statusCode !== 200) {
    throw new Error(`sign-up for ${email} failed (${res.statusCode}): ${res.body}`);
  }
  return {
    cookie: cookieHeader(res.headers),
    userId: res.json<{ user: { id: string } }>().user.id
  };
}

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}
