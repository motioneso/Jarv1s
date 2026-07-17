import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("AI provider validation endpoints", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: AiRepository;
  let server: ReturnType<typeof createApiServer>;
  let boss: PgBoss;
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    process.env.JARVIS_AI_SECRET_KEY = "test-ai-secret-key";

    await resetFoundationDatabase();
    await setUserAInstanceAdmin();

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new AiRepository();
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
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_AI_SECRET_KEY;
    } else {
      process.env.JARVIS_AI_SECRET_KEY = originalSecretKey;
    }
  });

  it("requires an instance admin for AI provider test and discovery", async () => {
    const provider = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createProvider(scopedDb, {
        providerKind: "openai-compatible",
        displayName: "Admin-only Provider",
        encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "admin-only-secret" })
      })
    );
    const testResponse = await server.inject({
      method: "POST",
      url: `/api/ai/providers/${provider.id}/test`,
      headers: { authorization: `Bearer ${ids.sessionB}` }
    });
    const discoverResponse = await server.inject({
      method: "POST",
      url: `/api/ai/providers/${provider.id}/discover-models`,
      headers: { authorization: `Bearer ${ids.sessionB}` }
    });

    expect(testResponse.statusCode).toBe(403);
    expect(discoverResponse.statusCode).toBe(403);
  });

  it("tests an API-key provider with a redacted result", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), { status: 200 })) as typeof fetch;
    try {
      const provider = await dataContext.withDataContext(userAContext(), (scopedDb) =>
        repository.createProvider(scopedDb, {
          providerKind: "openai-compatible",
          displayName: "Provider Test",
          baseUrl: "https://llm.example.test",
          encryptedCredential: createAiSecretCipher().encryptJson({
            apiKey: "secret-provider-key"
          })
        })
      );

      const response = await server.inject({
        method: "POST",
        url: `/api/ai/providers/${provider.id}/test`,
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        result: {
          ok: true,
          providerKind: "openai-compatible",
          message: "Provider credential is valid."
        }
      });
      expect(response.body).not.toContain("secret-provider-key");
      expect(response.body).not.toContain("ciphertext");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("discovers model candidates without inserting model rows", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), { status: 200 })) as typeof fetch;
    try {
      const provider = await dataContext.withDataContext(userAContext(), (scopedDb) =>
        repository.createProvider(scopedDb, {
          providerKind: "openai-compatible",
          displayName: "Discover Provider",
          encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "discover-secret" })
        })
      );
      const before = await dataContext.withDataContext(userAContext(), (scopedDb) =>
        repository.listModels(scopedDb)
      );
      const response = await server.inject({
        method: "POST",
        url: `/api/ai/providers/${provider.id}/discover-models`,
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });
      const after = await dataContext.withDataContext(userAContext(), (scopedDb) =>
        repository.listModels(scopedDb)
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        models: [{ providerModelId: "gpt-4o", capabilities: expect.arrayContaining(["chat"]) }]
      });
      expect(after).toHaveLength(before.length);
      expect(response.body).not.toContain("discover-secret");
      expect(response.body).not.toContain("ciphertext");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not test revoked AI providers", async () => {
    const provider = await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const created = await repository.createProvider(scopedDb, {
        providerKind: "openai-compatible",
        displayName: "Revoked Provider",
        encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "revoked-secret" })
      });
      await repository.revokeProvider(
        scopedDb,
        created.id,
        createAiSecretCipher().encryptJson({ revoked: true })
      );
      return created;
    });
    const response = await server.inject({
      method: "POST",
      url: `/api/ai/providers/${provider.id}/test`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("revoked-secret");
  });
});

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-ai-provider-validation"
  };
}

async function setUserAInstanceAdmin(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query(`UPDATE app.users SET is_instance_admin = true WHERE id = $1`, [ids.userA]);
  } finally {
    await client.end();
  }
}
