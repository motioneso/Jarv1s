import { randomUUID } from "node:crypto";

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

describe("AI admin per-user model pin", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: AiRepository;
  let server: ReturnType<typeof createApiServer>;
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    process.env.JARVIS_AI_SECRET_KEY = "test-ai-admin-pin-secret";

    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new AiRepository();
    server = createApiServer({ appDb, logger: false });
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

  it("binds a target user's AI calls to an admin pin and audits set/clear", async () => {
    const userBProviderId = await seedProvider(ids.userB, "User B Provider");
    const userAProviderId = await seedProvider(ids.userA, "User A Provider");
    const pinnedId = await seedModel(ids.userB, userBProviderId, "admin-pin-primary", [
      "chat",
      "json"
    ]);
    const fallbackId = await seedModel(ids.userB, userBProviderId, "admin-pin-fallback", ["chat"]);
    const userAModelId = await seedModel(ids.userA, userAProviderId, "admin-pin-wrong-owner", [
      "chat"
    ]);

    const enabledOverride = await server.inject({
      method: "PUT",
      url: "/api/admin/ai/chat-model-override",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { enabled: true }
    });
    const prePinOverride = await server.inject({
      method: "PUT",
      url: "/api/ai/chat-model-override",
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { modelId: fallbackId }
    });
    const deniedUserWrite = await server.inject({
      method: "PUT",
      url: `/api/admin/users/${ids.userB}/ai-pin`,
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { modelId: pinnedId }
    });
    const wrongOwner = await server.inject({
      method: "PUT",
      url: `/api/admin/users/${ids.userB}/ai-pin`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { modelId: userAModelId }
    });
    const setPin = await server.inject({
      method: "PUT",
      url: `/api/admin/users/${ids.userB}/ai-pin`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { modelId: pinnedId }
    });
    const getPin = await server.inject({
      method: "GET",
      url: `/api/admin/users/${ids.userB}/ai-pin`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });
    const pinnedResolution = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.resolveModelForCapability(scopedDb, "json", "interactive")
    );
    const selectedChatModel = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.selectChatModelForUser(scopedDb)
    );
    const blockedOverride = await server.inject({
      method: "PUT",
      url: "/api/ai/chat-model-override",
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { modelId: fallbackId }
    });

    await setModelStatus(pinnedId, "disabled");
    const unavailableResolution = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.resolveModelForCapability(scopedDb, "chat", "interactive")
    );

    const clearPin = await server.inject({
      method: "PUT",
      url: `/api/admin/users/${ids.userB}/ai-pin`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { modelId: null }
    });
    const savedOverride = await server.inject({
      method: "PUT",
      url: "/api/ai/chat-model-override",
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { modelId: fallbackId }
    });
    const auditRows = await dataContext.withDataContext(adminContext(), (scopedDb) =>
      scopedDb.db
        .selectFrom("app.admin_audit_events")
        .select(["action", "target_type", "target_id", "metadata"])
        .where("target_id", "=", ids.userB)
        .where("action", "in", ["ai.admin_pin.set", "ai.admin_pin.clear"])
        .orderBy("created_at", "asc")
        .execute()
    );

    expect(enabledOverride.statusCode).toBe(200);
    expect(prePinOverride.statusCode).toBe(200);
    expect(deniedUserWrite.statusCode).toBe(403);
    expect(wrongOwner.statusCode).toBe(400);
    expect(setPin.statusCode).toBe(200);
    expect(setPin.json()).toMatchObject({
      pin: {
        pinnedModelId: pinnedId,
        pinnedModel: { id: pinnedId },
        effectiveChatModel: { id: pinnedId },
        effectiveChatReason: "admin-pin"
      }
    });
    expect(setPin.body).not.toContain("admin-pin-secret");
    expect(setPin.body).not.toContain("encrypted_credential");
    expect(getPin.json()).toMatchObject({
      pin: {
        pinnedModelId: pinnedId,
        availableModels: expect.arrayContaining([expect.objectContaining({ id: pinnedId })])
      }
    });
    expect(pinnedResolution).toMatchObject({ reason: "admin-pin", model: { id: pinnedId } });
    expect(selectedChatModel).toMatchObject({ id: pinnedId });
    expect(blockedOverride.statusCode).toBe(409);
    expect(blockedOverride.json()).toMatchObject({
      error: "An admin has pinned your AI provider; contact them to change it"
    });
    expect(unavailableResolution).toMatchObject({
      reason: "admin-pin-unavailable",
      model: null
    });
    expect(clearPin.statusCode).toBe(200);
    expect(clearPin.json()).toMatchObject({ pin: { pinnedModelId: null, pinnedModel: null } });
    expect(savedOverride.statusCode).toBe(200);
    expect(savedOverride.json()).toMatchObject({
      settings: {
        currentOverrideModelId: fallbackId,
        effectiveOverrideModelId: fallbackId,
        selectedModel: { id: fallbackId }
      }
    });
    expect(auditRows).toEqual([
      {
        action: "ai.admin_pin.set",
        target_type: "user",
        target_id: ids.userB,
        metadata: { modelId: pinnedId }
      },
      {
        action: "ai.admin_pin.clear",
        target_type: "user",
        target_id: ids.userB,
        metadata: {}
      }
    ]);
  });

  // #870 locked decision #2: a model pin is a HARD routing constraint on ALL of the user's traffic.
  // When the pinned model can't serve a WORKER capability, the resolver routes the worker INSIDE the
  // pinned model's provider (never cross-provider) — there is no escape to the instance-wide route.
  it("worker capability with unavailable model pin routes inside the pinned provider (hard-lock)", async () => {
    const providerId = await seedProvider(ids.userB, "Hard-lock Provider");
    const pinnedId = await seedModel(ids.userB, providerId, "hardlock-pinned", ["json"]);
    const siblingId = await seedModel(ids.userB, providerId, "hardlock-sibling", ["json"]);

    await server.inject({
      method: "PUT",
      url: `/api/admin/users/${ids.userB}/ai-pin`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { modelId: pinnedId }
    });
    await setModelStatus(pinnedId, "disabled");

    // A capable sibling exists in the SAME provider → the worker resolves to it, still reason
    // "admin-pin" (traffic stays on the mandated backend).
    const resolvedInProvider = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.resolveModelForCapability(scopedDb, "json", "interactive")
    );

    expect(resolvedInProvider).toMatchObject({
      reason: "admin-pin",
      model: { id: siblingId }
    });

    // Disable the sibling too → no capable model in the pinned provider → needs-config, NO
    // cross-provider escape even though another provider CAN serve json (proves the hard-lock).
    const escapeProviderId = await seedProvider(ids.userB, "Escape Provider (must not be used)");
    await seedModel(ids.userB, escapeProviderId, "escape-json", ["json"]);
    await setModelStatus(siblingId, "disabled");
    const resolvedNeedsConfig = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.resolveModelForCapability(scopedDb, "json", "interactive")
    );

    expect(resolvedNeedsConfig).toMatchObject({ reason: "needs-config", model: null });

    await server.inject({
      method: "PUT",
      url: `/api/admin/users/${ids.userB}/ai-pin`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { modelId: null }
    });
  });

  it("pinned user's direct API call uses the pinned model at the HTTP perimeter", async () => {
    const providerId = await seedProvider(ids.userB, "Direct API Provider");
    const pinnedId = await seedModel(ids.userB, providerId, "direct-api-pinned", ["json"]);
    const otherId = await seedModel(ids.userB, providerId, "direct-api-other", ["json"]);

    await server.inject({
      method: "PUT",
      url: `/api/admin/users/${ids.userB}/ai-pin`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { modelId: pinnedId }
    });

    const res = await server.inject({
      method: "GET",
      url: "/api/ai/capability-route/json",
      headers: { authorization: `Bearer ${ids.sessionB}` }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      route: {
        capability: "json",
        available: true,
        reason: "admin-pin",
        model: { id: pinnedId }
      }
    });
    expect(res.body).not.toContain(otherId);

    await server.inject({
      method: "PUT",
      url: `/api/admin/users/${ids.userB}/ai-pin`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { modelId: null }
    });
  });

  async function seedProvider(ownerUserId: string, displayName: string): Promise<string> {
    const id = randomUUID();
    const credential = createAiSecretCipher().encryptJson({
      apiKey: `admin-pin-secret-${ownerUserId}`
    });
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `
          INSERT INTO app.ai_provider_configs (
            id,
            owner_user_id,
            provider_kind,
            display_name,
            status,
            auth_method,
            encrypted_credential
          )
          VALUES ($1, $2, 'anthropic', $3, 'active', 'api_key', $4::jsonb)
        `,
        [id, ownerUserId, displayName, JSON.stringify(credential)]
      );
    } finally {
      await client.end();
    }
    return id;
  }

  async function seedModel(
    ownerUserId: string,
    providerConfigId: string,
    providerModelId: string,
    capabilities: readonly ("chat" | "json")[]
  ): Promise<string> {
    const id = randomUUID();
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `
          INSERT INTO app.ai_configured_models (
            id,
            provider_config_id,
            owner_user_id,
            provider_model_id,
            display_name,
            capabilities,
            status,
            tier,
            allow_user_override
          )
          VALUES ($1, $2, $3, $4, $4, $5::text[], 'active', 'interactive', true)
        `,
        [id, providerConfigId, ownerUserId, providerModelId, capabilities]
      );
    } finally {
      await client.end();
    }
    return id;
  }

  async function setModelStatus(modelId: string, status: "active" | "disabled"): Promise<void> {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(`UPDATE app.ai_configured_models SET status = $2 WHERE id = $1`, [
        modelId,
        status
      ]);
    } finally {
      await client.end();
    }
  }
});

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-ai-admin-pin"
  };
}

function adminContext(): AccessContext {
  return {
    actorUserId: ids.adminUser,
    requestId: "request:admin-ai-admin-pin"
  };
}
