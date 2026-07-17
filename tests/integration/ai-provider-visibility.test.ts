import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("AI provider visibility and censoring", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let boss: PgBoss;

  beforeAll(async () => {
    await resetFoundationDatabase();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({
      appDb,
      boss,
      logger: false
    });
    await server.ready();

    // 1. Create active admin-owned provider and model
    const adminProviderRes = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerKind: "openai-compatible",
        displayName: "Admin OpenAI",
        baseUrl: "https://api.openai.com/v1",
        authMethod: "api_key",
        credentialPayload: { apiKey: "sk-admin-test" }
      }
    });
    if (adminProviderRes.statusCode !== 201) {
      throw new Error(`Failed to create admin provider: ${adminProviderRes.payload}`);
    }
    const adminProviderId = adminProviderRes.json().provider.id;

    const adminModelRes = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerConfigId: adminProviderId,
        providerModelId: "gpt-4",
        displayName: "GPT-4 Admin",
        capabilities: ["chat"],
        tier: "reasoning",
        allowUserOverride: true,
        status: "active"
      }
    });
    if (adminModelRes.statusCode !== 201) {
      throw new Error(`Failed to create admin model: ${JSON.stringify(adminModelRes.json())}`);
    }
    const adminModelId = adminModelRes.json().model.id;

    // 2. Create disabled model
    const disabledModelRes = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerConfigId: adminProviderId,
        providerModelId: "gpt-3.5-turbo",
        displayName: "GPT-3.5 Admin",
        capabilities: ["chat"],
        tier: "interactive",
        allowUserOverride: true,
        status: "active"
      }
    });
    if (disabledModelRes.statusCode !== 201) {
      throw new Error(
        `Failed to create disabled model: ${JSON.stringify(disabledModelRes.json())}`
      );
    }
    // disable it
    await server.inject({
      method: "PATCH",
      url: `/api/ai/models/${disabledModelRes.json().model.id}`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { status: "disabled" }
    });

    // 3. Create revoked provider and its model
    const revokedProviderRes = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerKind: "anthropic",
        displayName: "Admin Anthropic",
        baseUrl: "https://api.anthropic.com",
        authMethod: "api_key",
        credentialPayload: { apiKey: "sk-revoked" }
      }
    });
    if (revokedProviderRes.statusCode !== 201) {
      throw new Error(
        `Failed to create revoked provider: ${JSON.stringify(revokedProviderRes.json())}`
      );
    }
    const revokedProviderId = revokedProviderRes.json().provider.id;

    await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerConfigId: revokedProviderId,
        providerModelId: "claude-3-haiku",
        displayName: "Claude 3 Haiku",
        capabilities: ["chat"],
        tier: "interactive",
        allowUserOverride: true,
        status: "active"
      }
    });

    await server.inject({
      method: "POST",
      url: `/api/ai/providers/${revokedProviderId}/revoke`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });

    // 4. Set as default capability route
    await server.inject({
      method: "PUT",
      url: "/api/ai/capability-routes/chat",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { modelId: adminModelId }
    });
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
  });

  it("non-admin GET /api/ai/providers => 403", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(403);
  });

  it("non-admin GET /api/ai/models => 403", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /api/ai/summary returns ONLY {hasPersonalAiProvider, sharedAssistantAvailable}", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/ai/summary",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().summary)).toEqual([
      "hasPersonalAiProvider",
      "sharedAssistantAvailable"
    ]);
    expect(res.json()).toEqual({
      summary: {
        hasPersonalAiProvider: false,
        sharedAssistantAvailable: true
      }
    });
  });

  it("admin and member DTOs have no credential fields and censor providerKind/IDs for non-owners in capability route", async () => {
    // Admin gets full details for provider
    const adminProvidersRes = await server.inject({
      method: "GET",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });
    const adminProviders = adminProvidersRes.json().providers;
    expect(adminProviders[0].apiKey).toBeUndefined();
    expect(adminProviders[0].encrypted_credential).toBeUndefined();

    // Admin gets full details for model
    const adminModelsRes = await server.inject({
      method: "GET",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });
    const adminModels = adminModelsRes.json().models;
    expect(adminModels[0].apiKey).toBeUndefined();
    expect(adminModels[0].encrypted_credential).toBeUndefined();

    // Admin gets full details for capability route
    const adminRes = await server.inject({
      method: "GET",
      url: "/api/ai/capability-route/chat",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });
    const adminBody = adminRes.json();
    expect(adminBody.route.model.providerKind).toBe("openai-compatible");
    expect(adminBody.route.model.providerDisplayName).toBe("Admin OpenAI");
    expect(adminBody.route.model.providerModelId).toBe("gpt-4");
    expect(adminBody.route.model.apiKey).toBeUndefined(); // No credential

    // Member gets censored details
    const memberRes = await server.inject({
      method: "GET",
      url: "/api/ai/capability-route/chat",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    const memberBody = memberRes.json();
    expect(memberBody.route.model.providerKind).toBe(null);
    expect(memberBody.route.model.providerConfigId).toBe(null);
    expect(memberBody.route.model.providerModelId).toBe(null);
    expect(memberBody.route.model.providerDisplayName).toBe("Instance default");
    expect(memberBody.route.model.displayName).toBe("GPT-4 Admin");
    expect(memberBody.route.model.tier).toBe("reasoning");
    expect(memberBody.route.model.apiKey).toBeUndefined();
  });

  it("member chat-override choices = active+allowed+chat-capable only, omits disabled/revoked", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/ai/chat-model-override",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Only the active admin model should be present
    expect(body.settings.selectableOverrideModels).toHaveLength(1);
    expect(body.settings.selectableOverrideModels[0].displayName).toBe("GPT-4 Admin");
    // Should be censored
    expect(body.settings.selectableOverrideModels[0].providerKind).toBe(null);
    expect(body.settings.selectableOverrideModels[0].providerDisplayName).toBe("Instance default");
  });
});
