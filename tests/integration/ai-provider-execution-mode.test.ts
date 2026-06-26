import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("AI provider execution mode", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    server = createApiServer({ appDb, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("defaults providers to interactive mode", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerKind: "openai-compatible",
        displayName: "Codex",
        authMethod: "cli"
      }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().provider.executionMode).toBe("interactive");
  });

  it("persists provider execution mode updates", async () => {
    const createRes = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerKind: "openai-compatible",
        displayName: "Codex Noninteractive",
        authMethod: "cli",
        executionMode: "non_interactive"
      }
    });
    expect(createRes.statusCode).toBe(201);
    const providerId = createRes.json().provider.id;

    const patchRes = await server.inject({
      method: "PATCH",
      url: `/api/ai/providers/${providerId}`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { executionMode: "interactive" }
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().provider.executionMode).toBe("interactive");
  });

  it("rejects unknown execution modes", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerKind: "openai-compatible",
        displayName: "Bad Codex",
        authMethod: "cli",
        executionMode: "batch"
      }
    });

    expect(res.statusCode).toBe(400);
  });
});
