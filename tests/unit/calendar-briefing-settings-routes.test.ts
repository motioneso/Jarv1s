import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { AccessContext, DataContextDb, DataContextRunner, PreferencesPort } from "@jarv1s/db";

import { registerCalendarRoutes } from "../../packages/calendar/src/routes.js";

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
  registerCalendarRoutes(app, {
    resolveAccessContext: async () => userA,
    dataContext: {
      withDataContext: async <T>(_ac: AccessContext, work: (db: DataContextDb) => Promise<T>) =>
        work({} as DataContextDb)
    } as unknown as DataContextRunner,
    preferencesRepository: preferences
  });
  return { app, store };
}

describe("calendar briefing-settings routes (#736)", () => {
  it("GET defaults modes to suggest/suggest/off", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/calendar/briefing-settings" });

    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toMatchObject({
      prepTaskMode: "suggest",
      timeBlockMode: "suggest",
      commitmentMode: "off",
      suggestTasks: true,
      createTasks: false,
      suggestTimeBlocks: true,
      blockTime: false
    });
    await app.close();
  });

  it("GET normalizes invalid stored modes back to defaults", async () => {
    const { app } = buildApp({
      "calendar.prep_task_mode": "everything",
      "calendar.time_block_mode": "never",
      "calendar.commitment_mode": "maybe"
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/calendar/briefing-settings" });

    expect(res.json().settings).toMatchObject({
      prepTaskMode: "suggest",
      timeBlockMode: "suggest",
      commitmentMode: "off"
    });
    await app.close();
  });

  it("PATCH persists modes and derives legacy booleans", async () => {
    const { app, store } = buildApp();
    await app.ready();
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/calendar/briefing-settings",
      payload: { prepTaskMode: "auto", timeBlockMode: "off", commitmentMode: "suggest" }
    });

    expect(patch.statusCode).toBe(200);
    expect(patch.json().settings).toMatchObject({
      prepTaskMode: "auto",
      timeBlockMode: "off",
      commitmentMode: "suggest",
      suggestTasks: true,
      createTasks: true,
      suggestTimeBlocks: false,
      blockTime: false
    });
    expect(store.get("calendar.prep_task_mode")).toBe("auto");
    expect(store.get("calendar.time_block_mode")).toBe("off");
    expect(store.get("calendar.commitment_mode")).toBe("suggest");
    await app.close();
  });

  it("PATCH rejects an unknown mode with 400", async () => {
    const { app, store } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/calendar/briefing-settings",
      payload: { prepTaskMode: "yolo" }
    });

    expect(res.statusCode).toBe(400);
    expect(store.has("calendar.prep_task_mode")).toBe(false);
    await app.close();
  });
});
