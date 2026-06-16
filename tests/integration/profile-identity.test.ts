import type { OutgoingHttpHeaders } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { type Kysely } from "kysely";
import { createApiServer } from "../../apps/api/src/server.js";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

describe("profile identity", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let server: ReturnType<typeof createApiServer>;

  async function disableApproval() {
    await setInstanceSetting("registration.requires_approval", { value: false });
  }

  async function signUp(name: string, email: string) {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name, email, password: "password12345" }
    });
    expect(res.statusCode).toBe(200);
    return cookieHeader(res.headers);
  }

  async function getMe(cookie: string) {
    return server.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie }
    });
  }

  async function patchProfile(cookie: string, body: { name: string; addressed: string }) {
    return server.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: { "content-type": "application/json", cookie },
      payload: body
    });
  }

  beforeEach(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    const runner = new DataContextRunner(appDb);
    authRuntime = createJarvisAuthRuntime({ appDb, runner });
    server = createApiServer({ appDb, authRuntime, logger: false });
    await server.ready();
    await disableApproval();
  });

  afterEach(async () => {
    await Promise.allSettled([server?.close(), authRuntime?.close(), appDb?.destroy()]);
  });

  it("GET /api/me returns profilePrefs.addressed = null before any update", async () => {
    const cookie = await signUp("Alice Smith", "alice@example.test");
    const res = await getMe(cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: { name: string }; profilePrefs: { addressed: string | null } }>();
    expect(body.user.name).toBe("Alice Smith");
    expect(body.profilePrefs.addressed).toBeNull();
  });

  it("PATCH /api/me/profile returns 401 when unauthenticated", async () => {
    const res = await patchProfile("", { name: "Alice", addressed: "Al" });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /api/me/profile updates name and returns addressed in profilePrefs", async () => {
    const cookie = await signUp("Alice Smith", "alice2@example.test");
    const res = await patchProfile(cookie, { name: "Alice Johnson", addressed: "Al" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: { name: string }; profilePrefs: { addressed: string } }>();
    expect(body.user.name).toBe("Alice Johnson");
    expect(body.profilePrefs.addressed).toBe("Al");
  });

  it("subsequent GET /api/me returns the saved addressed value", async () => {
    const cookie = await signUp("Bob", "bob@example.test");
    await patchProfile(cookie, { name: "Bob", addressed: "Bobby" });
    const res = await getMe(cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ profilePrefs: { addressed: string } }>();
    expect(body.profilePrefs.addressed).toBe("Bobby");
  });

  it("user A cannot read or affect user B's addressed preference", async () => {
    const cookieA = await signUp("UserA", "usera@example.test");
    const cookieB = await signUp("UserB", "userb@example.test");
    await patchProfile(cookieA, { name: "UserA", addressed: "A-secret" });

    const beforeB = await getMe(cookieB);
    expect(beforeB.statusCode).toBe(200);
    expect(
      beforeB.json<{ profilePrefs: { addressed: string | null } }>().profilePrefs.addressed
    ).toBeNull();

    await patchProfile(cookieB, { name: "UserB", addressed: "B-secret" });
    const afterA = await getMe(cookieA);
    expect(afterA.statusCode).toBe(200);
    expect(
      afterA.json<{ profilePrefs: { addressed: string | null } }>().profilePrefs.addressed
    ).toBe("A-secret");
  });

  it("PATCH /api/me/profile rejects empty name with 400", async () => {
    const cookie = await signUp("Carol", "carol@example.test");
    const res = await patchProfile(cookie, { name: "", addressed: "C" });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /api/me/profile rejects name longer than 100 chars with 400", async () => {
    const cookie = await signUp("Dan", "dan@example.test");
    const res = await patchProfile(cookie, { name: "x".repeat(101), addressed: "D" });
    expect(res.statusCode).toBe(400);
  });
});

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];

  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}
