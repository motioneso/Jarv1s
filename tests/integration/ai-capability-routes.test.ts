import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { AiRepository } from "@jarv1s/ai";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { ids, connectionStrings, resetFoundationDatabase } from "./test-database.js";

// #870 Slice 1: the per-capability manual routes + tier preferences are retired. This suite covers
// their replacement — per-service bindings (Chat/Voice), the instance-default provider, and the
// resolver's mode/model/needs-config behaviour. Admin-owned config is created through the HTTP API
// as the instance admin (adminUser/sessionAdmin); pin behaviour lives in ai-admin-pin.test.ts.
describe("AI service bindings + instance-default resolver", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: AiRepository;
  let server: ReturnType<typeof createApiServer>;
  let originalSecretKey: string | undefined;
  let providerId: string;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    process.env.JARVIS_AI_SECRET_KEY = "test-ai-service-bindings-secret";

    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new AiRepository();
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    providerId = await seedProvider("Service binding provider");
    // Make it the instance default so "mode" bindings resolve inside it.
    const setDefault = await server.inject({
      method: "PUT",
      url: `/api/ai/providers/${providerId}/default`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });
    expect(setDefault.statusCode).toBe(200);
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_AI_SECRET_KEY;
    } else {
      process.env.JARVIS_AI_SECRET_KEY = originalSecretKey;
    }
  });

  it("resolves a mode binding inside the instance-default provider at the bound tier", async () => {
    // Two chat-capable models in the default provider on different tiers.
    await seedModel("mode-chat-economy", ["chat"], "economy");
    const reasoningId = await seedModel("mode-chat-reasoning", ["chat"], "reasoning");

    const putRes = await server.inject({
      method: "PUT",
      url: "/api/ai/services/chat/binding",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { binding: { kind: "mode", tier: "reasoning" } }
    });

    const resolved = await dataContext.withDataContext(adminContext(), (scopedDb) =>
      repository.resolveModelForCapability(scopedDb, "chat", "interactive")
    );

    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toMatchObject({
      service: "chat",
      binding: { kind: "mode", tier: "reasoning" }
    });
    expect(resolved.reason).toBe("matched-active-model");
    expect(resolved.model?.id).toBe(reasoningId);
  });

  it("resolves a model binding to the exact model and reports needs-config when it is disabled", async () => {
    const modelId = await seedModel("bind-exact-voice", ["transcription"], "interactive");

    await server.inject({
      method: "PUT",
      url: "/api/ai/services/transcription/binding",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { binding: { kind: "model", modelId } }
    });

    const resolvedActive = await dataContext.withDataContext(adminContext(), (scopedDb) =>
      repository.resolveModelForCapability(scopedDb, "transcription", "interactive")
    );

    // Disable the bound model — a user-facing service can't silently cross to another model.
    await server.inject({
      method: "PATCH",
      url: `/api/ai/models/${modelId}`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { status: "disabled" }
    });
    const resolvedDisabled = await dataContext.withDataContext(adminContext(), (scopedDb) =>
      repository.resolveModelForCapability(scopedDb, "transcription", "interactive")
    );

    expect(resolvedActive.reason).toBe("manual-route");
    expect(resolvedActive.model?.id).toBe(modelId);
    expect(resolvedDisabled.reason).toBe("needs-config");
    expect(resolvedDisabled.model).toBeNull();
  });

  it("lists service bindings via GET and never leaks provider credentials", async () => {
    const listRes = await server.inject({
      method: "GET",
      url: "/api/ai/service-bindings",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });
    const lookupRes = await server.inject({
      method: "GET",
      url: "/api/ai/capability-route/chat",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toMatchObject({
      bindings: { chat: { kind: "mode", tier: "reasoning" } }
    });
    expect(lookupRes.body).not.toContain("encrypted_credential");
    expect(lookupRes.body).not.toContain("service-binding-secret");
  });

  it("rejects a non-admin service binding write", async () => {
    const response = await server.inject({
      method: "PUT",
      url: "/api/ai/services/chat/binding",
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { binding: { kind: "mode", tier: "interactive" } }
    });

    expect(response.statusCode).toBe(403);
  });

  it("rejects binding a worker capability (only Chat/Voice are bindable)", async () => {
    const response = await server.inject({
      method: "PUT",
      url: "/api/ai/services/summarization/binding",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { binding: { kind: "mode", tier: "interactive" } }
    });

    expect(response.statusCode).toBe(400);
  });

  it("keeps worker capabilities cross-provider automatic (no binding required)", async () => {
    const summaryId = await seedModel("worker-summary", ["summarization"], "economy");

    const resolved = await dataContext.withDataContext(adminContext(), (scopedDb) =>
      repository.resolveModelForCapability(scopedDb, "summarization", "economy")
    );

    expect(resolved.reason).toBe("matched-active-model");
    expect(resolved.model?.id).toBe(summaryId);
  });

  it("promotes a provider to instance-default and clears the prior flag (H1 singleton)", async () => {
    const secondId = await seedProvider("Second provider");

    const putRes = await server.inject({
      method: "PUT",
      url: `/api/ai/providers/${secondId}/default`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });
    const listRes = await server.inject({
      method: "GET",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });
    const providers = listRes.json<{
      providers: { id: string; isInstanceDefault: boolean }[];
    }>().providers;
    const defaults = providers.filter((p) => p.isInstanceDefault);

    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toMatchObject({ provider: { id: secondId, isInstanceDefault: true } });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(secondId);

    // Restore the original default so later assertions in this file stay stable.
    await server.inject({
      method: "PUT",
      url: `/api/ai/providers/${providerId}/default`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });
  });

  it("preserves both writes when two services are bound concurrently (M1, no lost update)", async () => {
    const chatId = await seedModel("m1-chat", ["chat"], "interactive");
    const voiceId = await seedModel("m1-voice", ["transcription"], "interactive");

    // Two admins saving DIFFERENT services at the same time must not clobber each other.
    await Promise.all([
      dataContext.withDataContext(adminContext(), (scopedDb) =>
        repository.setServiceBinding(
          scopedDb,
          "chat",
          { kind: "model", modelId: chatId },
          ids.adminUser
        )
      ),
      dataContext.withDataContext(adminContext(), (scopedDb) =>
        repository.setServiceBinding(
          scopedDb,
          "transcription",
          { kind: "model", modelId: voiceId },
          ids.adminUser
        )
      )
    ]);

    const bindings = await dataContext.withDataContext(adminContext(), async (scopedDb) => ({
      chat: await repository.getServiceBinding(scopedDb, "chat"),
      voice: await repository.getServiceBinding(scopedDb, "transcription")
    }));

    expect(bindings.chat).toMatchObject({ kind: "model", modelId: chatId });
    expect(bindings.voice).toMatchObject({ kind: "model", modelId: voiceId });
  });

  async function seedProvider(displayName: string): Promise<string> {
    const response = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerKind: "anthropic",
        displayName,
        credentialPayload: { apiKey: "service-binding-secret" }
      }
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ provider: { id: string } }>().provider.id;
  }

  async function seedModel(
    providerModelId: string,
    capabilities: readonly string[],
    tier: string
  ): Promise<string> {
    const response = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerConfigId: providerId,
        providerModelId,
        displayName: providerModelId,
        capabilities,
        tier
      }
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ model: { id: string } }>().model.id;
  }
});

function adminContext(): AccessContext {
  return {
    actorUserId: ids.adminUser,
    requestId: "request:admin-ai-service-bindings"
  };
}
