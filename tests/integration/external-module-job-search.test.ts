// tests/integration/external-module-job-search.test.ts
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OutgoingHttpHeaders } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";

import { createApiServer } from "../../apps/api/src/server.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";
import { buildExternalModule } from "../../scripts/build-external-module.js";

// JS-01 (#930): full activation lifecycle of the REAL Job Search artifact against
// the real server — discovered→enable→active (web asset served, member-visible)
// →tamper→drift auto-disable→re-enable (new hash baseline)→explicit disable.
// Harness mirrors tests/integration/external-modules-routes.test.ts (better-auth
// first-signup bootstraps the admin) — do not invent a new auth path.
const sourceDir = fileURLToPath(new URL("../../external-modules/job-search", import.meta.url));

let root: string;
let modulesDir: string;
let installedDir: string;
let appDb: Kysely<JarvisDatabase>;
let boss: PgBoss;
let server: ReturnType<typeof createApiServer>;
let adminCookie: string;
let memberCookie: string;
let memberUserId: string;

// Discovery (incl. the trust hash) is a BOOT-TIME snapshot (server.ts
// discoverExternalModules → reconcile.ts compares the persisted enable-time
// hash against it). Filesystem tamper mid-run is invisible to a live server;
// drift manifests when a server boots over the changed package. So the drift
// leg of this fixture restarts the API over the same DB + modules dir —
// test-side only, mirroring a real operator restart.
const bootServer = async (): Promise<void> => {
  server = createApiServer({
    appDb,
    boss,
    logger: false,
    apiServerConfig: {
      host: "0.0.0.0",
      port: 0,
      mcpServerUrl: "http://127.0.0.1:0/api/mcp",
      externalModulesDir: modulesDir
    }
  });
  await server.ready();
};

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  await buildExternalModule(sourceDir);

  root = mkdtempSync(join(tmpdir(), "job-search-int-"));
  modulesDir = join(root, "modules");
  installedDir = join(modulesDir, "job-search");
  mkdirSync(installedDir, { recursive: true });
  cpSync(join(sourceDir, "jarvis.module.json"), join(installedDir, "jarvis.module.json"));
  cpSync(join(sourceDir, "dist"), join(installedDir, "dist"), { recursive: true });

  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
  // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
  // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
  // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
  // Test-only — production callers of createApiServer() are unaffected. One boss instance is
  // reused across bootServer() restarts (the server is recreated over the same appDb + boss).
  boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
  await bootServer();

  const admin = await signUp(server, "owner@job-search.test", "Owner");
  adminCookie = admin.cookie;
  const member = await signUp(server, "member@job-search.test", "Member");
  memberCookie = member.cookie;
  memberUserId = member.userId;
  const approve = await server.inject({
    method: "POST",
    url: `/api/admin/users/${memberUserId}/approve`,
    headers: { cookie: adminCookie }
  });
  expect(approve.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
  rmSync(root, { recursive: true, force: true });
});

const setEnabled = (enabled: boolean) =>
  server.inject({
    method: "POST",
    url: "/api/admin/external-modules/job-search",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    payload: { enabled }
  });

const adminView = async (): Promise<Record<string, unknown>> => {
  const res = await server.inject({
    method: "GET",
    url: "/api/admin/external-modules",
    headers: { cookie: adminCookie }
  });
  expect(res.statusCode).toBe(200);
  const modules = res.json<{ modules: Array<Record<string, unknown> & { id: string }> }>().modules;
  const found = modules.find((module) => module.id === "job-search");
  expect(found).toBeDefined();
  return found!;
};

const memberSeesModule = async (): Promise<boolean> => {
  const res = await server.inject({
    method: "GET",
    url: "/api/modules",
    headers: { cookie: memberCookie }
  });
  expect(res.statusCode).toBe(200);
  return res
    .json<{ modules: Array<{ id: string }> }>()
    .modules.some((module) => module.id === "job-search");
};

describe("job-search activation lifecycle (#930)", () => {
  it("is discovered but inactive before any enablement row exists", async () => {
    expect(await adminView()).toMatchObject({ status: "discovered", active: false });
    expect(await memberSeesModule()).toBe(false);
  });

  it("enable → active; web asset served; member sees the module", async () => {
    const res = await setEnabled(true);
    expect(res.statusCode).toBe(200);
    expect(res.json().module).toMatchObject({ status: "enabled", active: true });

    // The declared web contribution is actually servable, end to end.
    const asset = await server.inject({
      method: "GET",
      url: "/api/modules/job-search/web/dist/web/index.js",
      headers: { cookie: memberCookie }
    });
    expect(asset.statusCode).toBe(200);
    expect(String(asset.headers["content-type"])).toContain("javascript");
    expect(asset.body).toContain("__JARVIS_MODULE_RUNTIME__");

    expect(await memberSeesModule()).toBe(true);
  });

  it("post-enable artifact tamper → drift auto-disable; contributions vanish", async () => {
    const workerPath = join(installedDir, "dist/worker.js");
    writeFileSync(workerPath, `${readFileSync(workerPath, "utf8")}\n// tampered`);

    // Re-boot so discovery re-hashes the tampered package (see bootServer note).
    await server.close();
    await bootServer();

    expect(await adminView()).toMatchObject({
      status: "disabled",
      active: false,
      drifted: true,
      disabledReason: "package changed since it was enabled"
    });
    expect(await memberSeesModule()).toBe(false);
    const asset = await server.inject({
      method: "GET",
      url: "/api/modules/job-search/web/dist/web/index.js",
      headers: { cookie: memberCookie }
    });
    expect(asset.statusCode).toBe(404);
  });

  it("re-enable accepts the current package as the new hash baseline", async () => {
    const res = await setEnabled(true);
    expect(res.statusCode).toBe(200);
    expect(res.json().module).toMatchObject({ status: "enabled", active: true });
    expect(await memberSeesModule()).toBe(true);
  });

  it("explicit admin disable → inactive without a drift reason", async () => {
    const res = await setEnabled(false);
    expect(res.statusCode).toBe(200);
    expect(await adminView()).toMatchObject({ status: "disabled", active: false, drifted: false });
    expect(await memberSeesModule()).toBe(false);
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
