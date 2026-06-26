import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import type { AestheticThemeTokens, ListThemesResponse } from "@jarv1s/shared";
import { registerThemeRoutes } from "../../packages/settings/src/themes-routes.js";

const validThemeTokens: AestheticThemeTokens = {
  paper: "#fbfaf6",
  surface: "#ffffff",
  surface2: "#f5f3ed",
  surface3: "#edeae1",
  ink: "#292621",
  ink2: "#5b564d",
  ink3: "#8b8678",
  ink4: "#9a958a",
  line: "rgb(38, 34, 28)",
  lineSubtle: "rgb(245, 243, 237)",
  lineStrong: "rgb(210, 205, 194)",
  accent: "#2f6a4c"
};

describe("theme settings routes", () => {
  it("stores custom themes and strips semantic token writes", async () => {
    const prefs = new Map<string, unknown>();
    const server = Fastify({ logger: false });
    registerThemeRoutes(server, {
      dataContext: fakeDataContext(),
      resolveAccessContext: async () => ({ actorUserId: "user-a", requestId: "req-a" }),
      preferencesRepository: mapPreferences(prefs)
    });
    await server.ready();

    const put = await server.inject({
      method: "PUT",
      url: "/api/me/themes/my-blue",
      payload: {
        name: "My Blue",
        tokens: { ...validThemeTokens, red: "#000000" }
      }
    });
    const list = await server.inject({ method: "GET", url: "/api/me/themes" });

    expect(put.statusCode).toBe(200);
    expect(list.json<ListThemesResponse>().custom[0]?.tokens).toEqual(validThemeTokens);
    expect(JSON.stringify(prefs.get("themes.custom"))).not.toContain("red");

    await server.close();
  });
});

function fakeDataContext(): DataContextRunner {
  return {
    withDataContext: async <T>(
      _accessContext: unknown,
      callback: (scopedDb: DataContextDb) => Promise<T> | T
    ): Promise<T> => callback({} as DataContextDb)
  } as DataContextRunner;
}

function mapPreferences(values: Map<string, unknown>) {
  return {
    get: async (_scopedDb: DataContextDb, key: string) => values.get(key) ?? null,
    upsert: async (_scopedDb: DataContextDb, key: string, value: unknown) => {
      values.set(key, value);
    }
  };
}
