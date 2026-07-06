import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { AccessContext, DataContextDb, DataContextRunner, PreferencesPort } from "@jarv1s/db";

import { registerEmailRoutes } from "../../packages/email/src/routes.js";

const userA: AccessContext = {
  actorUserId: "00000000-0000-0000-0000-00000000000a",
  requestId: "req-a"
};

function makePreferences(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const preferences: PreferencesPort = {
    get: async (_db: DataContextDb, key: string) => store.get(key),
    upsert: async (_db: DataContextDb, key: string, value: unknown) => {
      store.set(key, value);
    }
  } as unknown as PreferencesPort;
  return { preferences, store };
}

function buildApp(initial: Record<string, unknown> = {}) {
  const { preferences, store } = makePreferences(initial);
  const app = Fastify();
  registerEmailRoutes(app, {
    resolveAccessContext: async () => userA,
    dataContext: {
      withDataContext: async <T>(_ac: AccessContext, work: (db: DataContextDb) => Promise<T>) =>
        work({} as DataContextDb)
    } as unknown as DataContextRunner,
    preferencesRepository: preferences
  });
  return { app, store };
}

describe("email task-creation-mode routes (#729 §5)", () => {
  it("GET defaults to suggest when no preference is stored", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/email/task-creation-mode" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ mode: "suggest" });
    await app.close();
  });

  it("GET normalizes an invalid stored preference back to suggest", async () => {
    const { app } = buildApp({ "email.task_creation_mode": "everything" });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/email/task-creation-mode" });
    expect(JSON.parse(res.body)).toEqual({ mode: "suggest" });
    await app.close();
  });

  it("PUT persists auto_safe and reads it back", async () => {
    const { app, store } = buildApp();
    await app.ready();
    const put = await app.inject({
      method: "PUT",
      url: "/api/email/task-creation-mode",
      payload: { mode: "auto_safe" }
    });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body)).toEqual({ mode: "auto_safe" });
    expect(store.get("email.task_creation_mode")).toBe("auto_safe");

    const res = await app.inject({ method: "GET", url: "/api/email/task-creation-mode" });
    expect(JSON.parse(res.body)).toEqual({ mode: "auto_safe" });
    await app.close();
  });

  it("PUT rejects an unknown mode with 400", async () => {
    const { app, store } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PUT",
      url: "/api/email/task-creation-mode",
      payload: { mode: "yolo" }
    });
    expect(res.statusCode).toBe(400);
    expect(store.has("email.task_creation_mode")).toBe(false);
    await app.close();
  });
});
