import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutgoingHttpHeaders } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createDatabase, type JarvisDatabase } from "@jarv1s/db";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

// #918 Task 27: exercises GET /api/modules/:moduleId/web/* (Task 19's asset route +
// Task 23... the containment logic in resolveModuleAssetPath) end-to-end, plus the
// ModuleDto/ExternalModuleDto `web` field round-trip (Task 18's schema additions).
// Harness mirrors external-modules-routes.test.ts / module-credentials.test.ts — do
// not invent a new path.

let root: string;
let appDb: Kysely<JarvisDatabase>;
let server: ReturnType<typeof createApiServer>;
let adminCookie: string;
let memberCookie: string;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  // The member-visibility assertion needs a genuinely active (non-pending) member
  // session — see module-credentials.test.ts for why this is required.
  await setInstanceSetting("registration.requires_approval", { value: false });

  root = mkdtempSync(join(tmpdir(), "webassets-routes-"));
  const modulesDir = join(root, "modules");

  // web-fixture: declares a web surface, gets real on-disk assets.
  const webDir = join(modulesDir, "web-fixture");
  const webDistDir = join(webDir, "dist", "web");
  mkdirSync(webDistDir, { recursive: true });
  writeFileSync(
    join(webDir, "jarvis.module.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "web-fixture",
      name: "Web Fixture",
      version: "0.1.0",
      publisher: "Test Publisher",
      lifecycle: "optional",
      compatibility: { jarv1s: ">=0.1.0" },
      web: { entrypoint: "dist/web/index.js", contractVersion: 1 }
    })
  );
  writeFileSync(join(webDistDir, "index.js"), "export default 1;\n");
  writeFileSync(join(webDistDir, "chunk.css"), "body { color: red; }\n");
  writeFileSync(join(webDistDir, ".env"), "SECRET=leak\n");
  // Symlink escape target lives OUTSIDE the module dir, in the tmp root.
  const outsideSecret = join(root, "outside-secret.txt");
  writeFileSync(outsideSecret, "host secret\n");
  symlinkSync(outsideSecret, join(webDistDir, "escape.js"));

  // no-web-fixture: no web declaration at all — the DTO contrast case.
  const noWebDir = join(modulesDir, "no-web-fixture");
  mkdirSync(noWebDir, { recursive: true });
  writeFileSync(
    join(noWebDir, "jarvis.module.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "no-web-fixture",
      name: "No Web Fixture",
      version: "0.1.0",
      publisher: "Test Publisher",
      lifecycle: "optional",
      compatibility: { jarv1s: ">=0.1.0" }
    })
  );

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

  adminCookie = (await signUp(server, "owner@webassets.test", "Owner")).cookie;
  memberCookie = (await signUp(server, "member@webassets.test", "Member")).cookie;

  for (const id of ["web-fixture", "no-web-fixture"]) {
    const res = await server.inject({
      method: "POST",
      url: `/api/admin/external-modules/${id}`,
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { enabled: true }
    });
    if (res.statusCode !== 200) {
      throw new Error(`enabling ${id} failed (${res.statusCode}): ${res.body}`);
    }
  }
});

afterAll(async () => {
  await Promise.allSettled([server?.close(), appDb?.destroy()]);
  rmSync(root, { recursive: true, force: true });
});

describe("module web asset route + DTO round-trip (#918)", () => {
  it("1. serves a declared asset with the containment/no-cache headers", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/modules/web-fixture/web/dist/web/index.js",
      headers: { cookie: adminCookie }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toBe("export default 1;\n");
  });

  it("2. rejects literal and percent-encoded traversal, never leaking the host tmpdir", async () => {
    const literal = await server.inject({
      method: "GET",
      url: "/api/modules/web-fixture/web/../jarvis.module.json",
      headers: { cookie: adminCookie }
    });
    expect(literal.statusCode).toBe(404);
    expect(literal.body).not.toContain(tmpdir());

    const encoded = await server.inject({
      method: "GET",
      url: "/api/modules/web-fixture/web/%2e%2e%2fjarvis.module.json",
      headers: { cookie: adminCookie }
    });
    expect(encoded.statusCode).toBe(404);
    expect(encoded.body).not.toContain(tmpdir());
  });

  it("3. rejects an absolute-path escape attempt", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/modules/web-fixture/web//etc/hostname",
      headers: { cookie: adminCookie }
    });
    expect(res.statusCode).toBe(404);
  });

  it("4. rejects an unsupported asset type", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/modules/web-fixture/web/dist/web/.env",
      headers: { cookie: adminCookie }
    });
    expect(res.statusCode).toBe(404);
  });

  it("5. rejects a symlink that escapes the module package", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/modules/web-fixture/web/dist/web/escape.js",
      headers: { cookie: adminCookie }
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("host secret");
  });

  it("6. a disabled module 404s indistinguishably from unknown", async () => {
    const disable = await server.inject({
      method: "POST",
      url: "/api/admin/external-modules/web-fixture",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { enabled: false }
    });
    expect(disable.statusCode).toBe(200);

    const res = await server.inject({
      method: "GET",
      url: "/api/modules/web-fixture/web/dist/web/index.js",
      headers: { cookie: adminCookie }
    });
    expect(res.statusCode).toBe(404);

    // Re-enable for the remaining tests.
    const reenable = await server.inject({
      method: "POST",
      url: "/api/admin/external-modules/web-fixture",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { enabled: true }
    });
    expect(reenable.statusCode).toBe(200);
  });

  it("7. a member (any authenticated actor) can fetch the asset; anonymous cannot", async () => {
    const memberRes = await server.inject({
      method: "GET",
      url: "/api/modules/web-fixture/web/dist/web/index.js",
      headers: { cookie: memberCookie }
    });
    expect(memberRes.statusCode).toBe(200);

    const anonRes = await server.inject({
      method: "GET",
      url: "/api/modules/web-fixture/web/dist/web/index.js"
    });
    expect(anonRes.statusCode).toBe(401);
  });

  it("8. the DTO round-trip: web populated on one module, absent/null on the other", async () => {
    const externalRes = await server.inject({
      method: "GET",
      url: "/api/admin/external-modules",
      headers: { cookie: adminCookie }
    });
    expect(externalRes.statusCode).toBe(200);
    const externalModules = externalRes.json().modules as Array<{ id: string; web: unknown }>;
    expect(externalModules.find((m) => m.id === "web-fixture")).toMatchObject({
      web: { entrypoint: "dist/web/index.js", contractVersion: 1 }
    });
    // ExternalModuleDto.web is non-optional and nullable — absent declaration round-trips
    // to an explicit null, not an omitted field.
    expect(externalModules.find((m) => m.id === "no-web-fixture")).toMatchObject({ web: null });

    const modulesRes = await server.inject({
      method: "GET",
      url: "/api/modules",
      headers: { cookie: adminCookie }
    });
    expect(modulesRes.statusCode).toBe(200);
    const modules = modulesRes.json().modules as Array<Record<string, unknown>>;
    const withWeb = modules.find((m) => m.id === "web-fixture");
    expect(withWeb?.web).toEqual({ entrypoint: "dist/web/index.js", contractVersion: 1 });
    // ModuleDto.web is optional — an undeclared web surface is OMITTED, not null.
    const withoutWeb = modules.find((m) => m.id === "no-web-fixture");
    expect(withoutWeb).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(withoutWeb, "web")).toBe(false);
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
