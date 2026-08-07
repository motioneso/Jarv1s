import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutgoingHttpHeaders } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createDatabase, type MossDatabase } from "@moss/db";

import { createApiServer } from "../../apps/api/src/server.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

// #1285 / ledger G8: a manifest-declared `badge` crosses FOUR strip points on its way
// to the browser — the module-sdk type, the validator's reconstruction literal, the
// Fastify response schema, and serializeExternalModule's field-by-field mapper. The
// unit test (external-module-nav-badge.test.ts) and the notifications-repository
// integration test (notifications-unread-by-module.test.ts) each cover one link in
// that chain in isolation. This test is the one that proves the LAST link — the
// schema/serializer pair — doesn't silently strip `badge` the same way #1282's
// `briefing` field once did: it boots the real server, enables a fixture module whose
// manifest declares a badge, and asserts the field survives an actual HTTP response
// (fast-json-stringify runs on this path; a pure DTO-construction assertion would not
// catch a schema that's missing the property).
//
// Modeled on tests/integration/external-modules-routes.test.ts (#917) — same
// admin-enable-then-GET-/api/modules flow, same better-auth sign-up cookie pattern.

let root: string;
let appDb: Kysely<MossDatabase>;
let server: ReturnType<typeof createApiServer>;
let adminCookie: string;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();

  root = mkdtempSync(join(tmpdir(), "badge-response-"));
  const modulesDir = join(root, "modules");
  const dir = join(modulesDir, "badge-fixture");
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "worker.js"), "// fixture worker\n");
  writeFileSync(
    join(dir, "jarvis.module.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "badge-fixture",
      name: "Badge Fixture",
      version: "0.1.0",
      publisher: "Test Publisher",
      lifecycle: "optional",
      compatibility: { jarv1s: ">=0.1.0" },
      navigation: [
        {
          id: "badge-fixture",
          label: "Fixture",
          path: "/",
          icon: "briefcase",
          order: 1,
          badge: { source: "notifications" }
        }
      ],
      runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
      worker: {
        queues: [{ name: "badge-fixture.manual", handler: "manual", allowManualRun: true }]
      }
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
      externalModulesDir: modulesDir
    }
  });
  await server.ready();

  // First sign-up bootstraps the instance owner (admin) — the only actor this test needs.
  const admin = await signUp(server, "owner@badge-response.test", "Owner");
  adminCookie = admin.cookie;
});

afterAll(async () => {
  await Promise.allSettled([server?.close(), appDb?.destroy()]);
  rmSync(root, { recursive: true, force: true });
});

describe("external module nav badge survives the /api/modules response (#1285)", () => {
  it("re-emits navigation[].badge after enabling the module", async () => {
    const enableRes = await server.inject({
      method: "POST",
      url: "/api/admin/external-modules/badge-fixture",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { enabled: true }
    });
    expect(enableRes.statusCode).toBe(200);

    const modulesRes = await server.inject({
      method: "GET",
      url: "/api/modules",
      headers: { cookie: adminCookie }
    });
    expect(modulesRes.statusCode).toBe(200);

    const listed = modulesRes.json().modules.find((m: { id: string }) => m.id === "badge-fixture");
    expect(listed).toMatchObject({
      id: "badge-fixture",
      external: true,
      navigation: [
        {
          id: "badge-fixture",
          label: "Fixture",
          path: "/m/badge-fixture",
          badge: { source: "notifications" }
        }
      ]
    });
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
