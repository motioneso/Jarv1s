import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("AI capability route overrides", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: AiRepository;
  let server: ReturnType<typeof createApiServer>;
  let originalSecretKey: string | undefined;
  let sharedProviderId: string;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    process.env.JARVIS_AI_SECRET_KEY = "test-ai-secret-key";

    await resetFoundationDatabase();
    await setUserAInstanceAdmin();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new AiRepository();
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    const provider = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createProvider(scopedDb, {
        providerKind: "anthropic",
        displayName: "Capability route provider",
        encryptedCredential: createAiSecretCipher().encryptJson({
          apiKey: "capability-route-secret"
        })
      })
    );
    sharedProviderId = provider.id;
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_AI_SECRET_KEY;
    } else {
      process.env.JARVIS_AI_SECRET_KEY = originalSecretKey;
    }
  });

  it("uses a valid manual capability route before automatic tier selection", async () => {
    const automaticRes = await createModel("manual-json-auto", ["json"], "interactive");
    const manualRes = await createModel("manual-json-selected", ["json"], "reasoning");
    const manualId = manualRes.json<{ model: { id: string } }>().model.id;

    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.setCapabilityRoute(scopedDb, {
        capability: "json",
        modelId: manualId,
        actorUserId: ids.userA
      })
    );

    const resolved = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.resolveModelForCapability(scopedDb, "json", "interactive")
    );
    const selected = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.selectModelForCapability(scopedDb, "json", "interactive")
    );

    expect(automaticRes.statusCode).toBe(201);
    expect(manualRes.statusCode).toBe(201);
    expect(resolved.reason).toBe("manual-route");
    expect(resolved.model?.id).toBe(manualId);
    expect(selected?.id).toBe(manualId);
  });

  it("falls back when a manual capability route becomes incompatible", async () => {
    const compatibleRes = await createModel("manual-vision-compatible", ["vision"], "interactive");
    const staleRes = await createModel("manual-vision-stale", ["vision"], "reasoning");
    const compatibleId = compatibleRes.json<{ model: { id: string } }>().model.id;
    const staleId = staleRes.json<{ model: { id: string } }>().model.id;

    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.setCapabilityRoute(scopedDb, {
        capability: "vision",
        modelId: staleId,
        actorUserId: ids.userA
      })
    );
    await server.inject({
      method: "PATCH",
      url: `/api/ai/models/${staleId}`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { status: "disabled" }
    });

    const resolved = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.resolveModelForCapability(scopedDb, "vision", "interactive")
    );

    expect(compatibleRes.statusCode).toBe(201);
    expect(staleRes.statusCode).toBe(201);
    expect(resolved.reason).toBe("manual-route-unavailable-fallback");
    expect(resolved.model?.id).toBe(compatibleId);
  });

  it("lets an admin set, read, use, and clear a manual capability route", async () => {
    const modelRes = await createModel("route-api-chat", ["chat"], "interactive");
    const modelId = modelRes.json<{ model: { id: string } }>().model.id;

    const putRes = await server.inject({
      method: "PUT",
      url: "/api/ai/capability-routes/chat",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { modelId }
    });
    const listRes = await server.inject({
      method: "GET",
      url: "/api/ai/capability-routes",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    const lookupRes = await server.inject({
      method: "GET",
      url: "/api/ai/capability-route/chat",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    const clearRes = await server.inject({
      method: "PUT",
      url: "/api/ai/capability-routes/chat",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { modelId: null }
    });

    expect(modelRes.statusCode).toBe(201);
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toMatchObject({ route: { capability: "chat", modelId } });
    expect(listRes.json()).toMatchObject({ routes: { chat: modelId } });
    expect(lookupRes.json()).toMatchObject({
      route: { capability: "chat", reason: "manual-route", model: { id: modelId } }
    });
    expect(lookupRes.body).not.toContain("encrypted_credential");
    expect(clearRes.json()).toMatchObject({ route: { capability: "chat", modelId: null } });
  });

  it("rejects non-admin capability route writes", async () => {
    const response = await server.inject({
      method: "PUT",
      url: "/api/ai/capability-routes/chat",
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { modelId: null }
    });

    expect(response.statusCode).toBe(403);
  });

  function createModel(providerModelId: string, capabilities: readonly string[], tier: string) {
    return server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {
        providerConfigId: sharedProviderId,
        providerModelId,
        displayName: providerModelId,
        capabilities,
        tier
      }
    });
  }
});

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-ai-capability-routes"
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
