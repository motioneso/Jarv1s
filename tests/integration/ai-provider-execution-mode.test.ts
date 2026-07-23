import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("AI provider execution mode", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let boss: PgBoss;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, boss, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
  });

  // #1238/#1239: one-shot ("-p"/"exec") is the default for every provider; interactive is an
  // opt-in per-provider fallback (proven by the create-with-non_interactive + patch-to-interactive
  // cases below). A create that omits executionMode must resolve to non_interactive.
  it("defaults providers to non_interactive (one-shot) mode", async () => {
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
    expect(res.json().provider.executionMode).toBe("non_interactive");
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
