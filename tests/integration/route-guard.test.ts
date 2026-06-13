import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

function cookieHeader(headers: Record<string, unknown>): string {
  const raw = headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => String(c).split(";")[0]).join("; ");
}

describe("module enablement endpoints", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let ownerCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    await setInstanceSetting("registration.requires_approval", { value: false });
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Owner",
        email: "owner@example.test",
        password: "correct horse battery staple"
      }
    });
    ownerCookie = cookieHeader(signUp.headers as Record<string, unknown>);
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("GET /api/admin/modules lists every built-in with required + instanceDisabled flags", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/modules",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      modules: { id: string; required: boolean; instanceDisabled: boolean }[];
    }>();
    const tasks = body.modules.find((m) => m.id === "tasks");
    expect(tasks?.required).toBe(true);
    expect(tasks?.instanceDisabled).toBe(false);
    expect(body.modules.length).toBeGreaterThanOrEqual(11);
  });

  it("admin disabling a required module is rejected with 409", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/api/admin/modules/tasks",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { disabled: true }
    });
    expect(res.statusCode).toBe(409);
  });

  it("admin disabling an unknown module is 404", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/api/admin/modules/does-not-exist",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { disabled: true }
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/me/modules returns active flags for the caller", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/modules",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ modules: { id: string; active: boolean }[] }>();
    expect(body.modules.every((m) => m.active)).toBe(true);
  });

  it("self disabling a required module is 409", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/api/me/modules/tasks",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { disabled: true }
    });
    expect(res.statusCode).toBe(409);
  });

  it("a non-admin actor cannot reach the admin endpoint", async () => {
    // Register a second, non-admin user (requires_approval is off so they are active).
    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Member",
        email: "member@example.test",
        password: "correct horse battery staple x"
      }
    });
    const memberCookie = cookieHeader(signUp.headers as Record<string, unknown>);
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/modules",
      headers: { cookie: memberCookie }
    });
    expect(res.statusCode).toBe(403);
  });

  it("a non-admin PATCH gets 403 even for an unknown or required module (no existence leak)", async () => {
    // Re-register a non-admin member (cookies above are scoped to other tests).
    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Member2",
        email: "member2@example.test",
        password: "correct horse battery staple y"
      }
    });
    const memberCookie = cookieHeader(signUp.headers as Record<string, unknown>);
    // Unknown module: an admin would get 404, a required module 409 — a non-admin must
    // get 403 for BOTH, so the response cannot be used to probe module existence/status.
    const unknown = await server.inject({
      method: "PATCH",
      url: "/api/admin/modules/does-not-exist",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      payload: { disabled: true }
    });
    expect(unknown.statusCode).toBe(403);
    const required = await server.inject({
      method: "PATCH",
      url: "/api/admin/modules/tasks",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      payload: { disabled: true }
    });
    expect(required.statusCode).toBe(403);
  });
});
