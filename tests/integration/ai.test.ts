import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  AiRepository,
  aiModuleManifest,
  createAiSecretCipher,
  type EncryptedAiSecret
} from "@jarv1s/ai";
import {
  AuthSessionResolver,
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  getBuiltInModuleManifests,
  getBuiltInModuleRegistrations,
  getBuiltInSqlMigrationDirectories
} from "@jarv1s/module-registry";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("AI provider foundation", () => {
  let appDb: Kysely<JarvisDatabase>;
  let auth: AuthSessionResolver;
  let dataContext: DataContextRunner;
  let repository: AiRepository;
  let server: ReturnType<typeof createApiServer>;
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    process.env.JARVIS_AI_SECRET_KEY = "test-ai-secret-key";

    await resetFoundationDatabase();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    auth = new AuthSessionResolver(appDb);
    dataContext = new DataContextRunner(appDb);
    repository = new AiRepository();
    server = createApiServer({
      appDb,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_AI_SECRET_KEY;
    } else {
      process.env.JARVIS_AI_SECRET_KEY = originalSecretKey;
    }
  });

  it("applies AI migrations with forced RLS and no worker table grants", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });

    await client.connect();
    try {
      const migrations = await client.query<{ version: string; name: string }>(
        `
          SELECT version, name
          FROM app.schema_migrations
          WHERE version IN ('0013', '0016')
          ORDER BY version
        `
      );
      const tables = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        owner: string;
        worker_has_access: boolean;
      }>(
        `
          SELECT
            c.relname,
            c.relrowsecurity,
            c.relforcerowsecurity,
            pg_get_userbyid(c.relowner) AS owner,
            (
              has_table_privilege('jarvis_worker_runtime', c.oid, 'SELECT')
              OR has_table_privilege('jarvis_worker_runtime', c.oid, 'INSERT')
              OR has_table_privilege('jarvis_worker_runtime', c.oid, 'UPDATE')
              OR has_table_privilege('jarvis_worker_runtime', c.oid, 'DELETE')
            ) AS worker_has_access
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname IN (
              'ai_provider_configs',
              'ai_configured_models',
              'ai_assistant_action_requests'
            )
          ORDER BY c.relname
        `
      );

      expect(migrations.rows).toEqual([
        { version: "0013", name: "0013_ai_module.sql" },
        { version: "0016", name: "0016_ai_assistant_actions.sql" }
      ]);
      expect(tables.rows).toEqual([
        {
          relname: "ai_assistant_action_requests",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_has_access: false
        },
        {
          relname: "ai_configured_models",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_has_access: false
        },
        {
          relname: "ai_provider_configs",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_has_access: false
        }
      ]);
    } finally {
      await client.end();
    }
  });

  it("loads AI as a required built-in module without queues", () => {
    const manifests = getBuiltInModuleManifests();
    const registration = getBuiltInModuleRegistrations().find(
      (item) => item.manifest.id === aiModuleManifest.id
    );
    const manifest = manifests.find((item) => item.id === aiModuleManifest.id);

    expect(manifests.map((item) => item.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings",
      "memory"
    ]);
    expect(manifest?.database?.ownedTables).toEqual([
      "app.ai_provider_configs",
      "app.ai_configured_models",
      "app.ai_assistant_action_requests"
    ]);
    expect(manifest?.settings?.[0]).toMatchObject({
      id: "ai.user-settings",
      path: "/settings/ai",
      permissionId: "ai.manage"
    });
    expect(registration?.queueDefinitions).toEqual([]);
    expect(manifest?.routes?.map((route) => route.path)).toContain("/api/ai/assistant-actions");
    expect(manifest?.routes?.map((route) => route.path)).toContain(
      "/api/ai/assistant-actions/:id/resolve"
    );
    expect(getBuiltInSqlMigrationDirectories()).toContainEqual(
      expect.stringContaining("packages/ai/sql")
    );
  });

  it("requires an explicit AI secret key in production", () => {
    expect(() =>
      createAiSecretCipher({
        NODE_ENV: "production"
      })
    ).toThrow("JARVIS_AI_SECRET_KEY is required in production");
  });

  it("encrypts provider credentials at rest and never returns secret material", async () => {
    const createResponse = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerKind: "openai-compatible",
        displayName: "Local OpenAI Compatible",
        baseUrl: "https://llm.example.test/v1",
        credentialPayload: {
          apiKey: "secret-ai-api-key"
        }
      }
    });
    const provider = createResponse.json<{ provider: { id: string; hasCredential: boolean } }>()
      .provider;
    const encryptedCredential = await readEncryptedCredential(provider.id);
    const encryptedJson = JSON.stringify(encryptedCredential);
    const decrypted = createAiSecretCipher().decryptJson(encryptedCredential);
    const listResponse = await server.inject({
      method: "GET",
      url: "/api/ai/providers",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(provider.hasCredential).toBe(true);
    expect(createResponse.body).not.toContain("secret-ai-api-key");
    expect(createResponse.body).not.toContain("encrypted_credential");
    expect(createResponse.body).not.toContain("ciphertext");
    expect(encryptedJson).not.toContain("secret-ai-api-key");
    expect(decrypted).toEqual({
      apiKey: "secret-ai-api-key"
    });
    expect(listResponse.body).not.toContain("secret-ai-api-key");
    expect(listResponse.body).not.toContain("ciphertext");
  });

  it("keeps provider and model rows isolated by owner and does not give admins a bypass", async () => {
    const userBProvider = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.createProvider(scopedDb, {
        providerKind: "custom",
        displayName: "User B private provider",
        baseUrl: "https://user-b.example.test",
        encryptedCredential: createAiSecretCipher().encryptJson({
          apiKey: "user-b-ai-secret"
        })
      })
    );
    await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.createModel(scopedDb, {
        providerConfigId: userBProvider.id,
        providerModelId: "user-b-model",
        displayName: "User B model",
        capabilities: ["chat"]
      })
    );
    const userAProviders = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listProviders(scopedDb)
    );
    const userAModels = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listModels(scopedDb)
    );
    const adminContext = await auth.resolveAccessContext(ids.sessionAdmin, "request:admin-ai");
    const adminProviders = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.listProviders(scopedDb)
    );
    const adminModels = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.listModels(scopedDb)
    );

    expect(userAProviders.some((provider) => provider.id === userBProvider.id)).toBe(false);
    expect(userAModels.some((model) => model.provider_config_id === userBProvider.id)).toBe(false);
    expect(adminProviders.some((provider) => provider.id === userBProvider.id)).toBe(false);
    expect(adminModels.some((model) => model.provider_config_id === userBProvider.id)).toBe(false);
  });

  it("selects an active configured model by capability without returning secrets", async () => {
    const providerResponse = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerKind: "anthropic",
        displayName: "Anthropic BYO",
        credentialPayload: {
          apiKey: "capability-secret"
        }
      }
    });
    const disabledProviderResponse = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerKind: "custom",
        displayName: "Disabled Provider",
        status: "disabled",
        credentialPayload: {
          apiKey: "disabled-secret"
        }
      }
    });
    const providerId = providerResponse.json<{ provider: { id: string } }>().provider.id;
    const disabledProviderId = disabledProviderResponse.json<{ provider: { id: string } }>()
      .provider.id;
    const disabledModelResponse = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerConfigId: disabledProviderId,
        providerModelId: "disabled-model",
        displayName: "Disabled model",
        capabilities: ["chat"],
        status: "active"
      }
    });
    const modelResponse = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerConfigId: providerId,
        providerModelId: "claude-3-5-haiku",
        displayName: "Haiku",
        capabilities: ["chat", "tool-use"],
        status: "active"
      }
    });
    const model = modelResponse.json<{ model: { id: string } }>().model;
    const routeResponse = await server.inject({
      method: "GET",
      url: "/api/ai/capability-route/chat",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });

    expect(disabledModelResponse.statusCode).toBe(201);
    expect(modelResponse.statusCode).toBe(201);
    expect(routeResponse.statusCode).toBe(200);
    expect(routeResponse.json()).toMatchObject({
      route: {
        capability: "chat",
        available: true,
        reason: "matched-active-model",
        model: {
          id: model.id,
          providerConfigId: providerId,
          providerStatus: "active",
          providerModelId: "claude-3-5-haiku"
        }
      }
    });
    expect(routeResponse.body).not.toContain("capability-secret");
    expect(routeResponse.body).not.toContain("disabled-secret");
    expect(routeResponse.body).not.toContain("ciphertext");
  });

  it("updates, deactivates, and revokes configs without leaking replacement credentials", async () => {
    const providerResponse = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerKind: "google",
        displayName: "Google BYO",
        credentialPayload: {
          apiKey: "before-update"
        }
      }
    });
    const providerId = providerResponse.json<{ provider: { id: string } }>().provider.id;
    const updateProviderResponse = await server.inject({
      method: "PATCH",
      url: `/api/ai/providers/${providerId}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        displayName: "Google Updated",
        status: "disabled",
        credentialPayload: {
          apiKey: "after-update"
        }
      }
    });
    const modelResponse = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        providerConfigId: providerId,
        providerModelId: "gemini-test",
        displayName: "Gemini Test",
        capabilities: ["json"],
        status: "active"
      }
    });
    const modelId = modelResponse.json<{ model: { id: string } }>().model.id;
    const updateModelResponse = await server.inject({
      method: "PATCH",
      url: `/api/ai/models/${modelId}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        status: "disabled",
        capabilities: ["json", "vision"]
      }
    });
    const updatedSecret = await readEncryptedCredential(providerId);
    const revokeProviderResponse = await server.inject({
      method: "POST",
      url: `/api/ai/providers/${providerId}/revoke`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const revokedSecret = await readEncryptedCredential(providerId);

    expect(updateProviderResponse.statusCode).toBe(200);
    expect(updateProviderResponse.body).not.toContain("after-update");
    expect(updateProviderResponse.json()).toMatchObject({
      provider: {
        id: providerId,
        displayName: "Google Updated",
        status: "disabled",
        hasCredential: true
      }
    });
    expect(createAiSecretCipher().decryptJson(updatedSecret)).toEqual({
      apiKey: "after-update"
    });
    expect(updateModelResponse.statusCode).toBe(200);
    expect(updateModelResponse.json()).toMatchObject({
      model: {
        id: modelId,
        status: "disabled",
        capabilities: ["json", "vision"]
      }
    });
    expect(revokeProviderResponse.statusCode).toBe(200);
    expect(revokeProviderResponse.body).not.toContain("after-update");
    expect(revokeProviderResponse.json()).toMatchObject({
      provider: {
        id: providerId,
        status: "revoked",
        revokedAt: expect.any(String)
      }
    });
    expect(createAiSecretCipher().decryptJson(revokedSecret)).toEqual({
      revoked: true
    });
  });

  it("serves assistant tool metadata from module manifests without execution access", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/ai/assistant-tools",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const tools = response.json<{
      tools: Array<{
        moduleId: string;
        name: string;
        permissionId: string;
        risk: string;
        inputSchema: Record<string, unknown> | null;
      }>;
    }>().tools;
    const manifestTools = getBuiltInModuleManifests().flatMap((module) =>
      (module.assistantTools ?? []).map((tool) => `${module.id}:${tool.name}`)
    );

    expect(response.statusCode).toBe(200);
    expect(tools.map((tool) => `${tool.moduleId}:${tool.name}`)).toEqual(manifestTools);
    expect(tools).toContainEqual(
      expect.objectContaining({
        moduleId: "tasks",
        name: "tasks.updateStatus",
        permissionId: "tasks.update",
        risk: "write",
        inputSchema: expect.objectContaining({
          type: "object"
        })
      })
    );
    expect(response.body).not.toContain("execute");
    expect(response.body).not.toContain("encrypted_credential");
    expect(response.body).not.toContain("ciphertext");
  });

  it("fails loudly when the AI repository is called without withDataContext", async () => {
    await expect(repository.listProviders({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(repository.selectModelForCapability({} as never, "chat")).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });
});

async function readEncryptedCredential(providerId: string): Promise<EncryptedAiSecret> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    const row = await client.query<{ encrypted_credential: EncryptedAiSecret }>(
      `
        SELECT encrypted_credential
        FROM app.ai_provider_configs
        WHERE id = $1
      `,
      [providerId]
    );
    const encryptedCredential = row.rows[0]?.encrypted_credential;

    if (!encryptedCredential) {
      throw new Error(`Missing AI provider config ${providerId}`);
    }

    return encryptedCredential;
  } finally {
    await client.end();
  }
}

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-ai"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-ai"
  };
}
