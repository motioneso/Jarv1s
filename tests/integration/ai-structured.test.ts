import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import {
  AiRepository,
  createAiSecretCipher,
  generateStructured,
  type GenerateStructuredProviderInput
} from "@jarv1s/ai";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";

import { createApiServer } from "../../apps/api/src/server.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

// #915 slice 3: module service bindings, service-aware resolution, and generateStructured.
// Suites are STATEFUL and order-dependent (shared instance_settings blob + seeded models) —
// every test restores the bindings it writes.

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;
let repository: AiRepository;
let server: Awaited<ReturnType<typeof createApiServer>>;
let previousSecretKey: string | undefined;
let realFetch: typeof globalThis.fetch;

let providerId: string;
let modelEconomyJsonId: string;
let modelReasoningJsonId: string;
let modelChatJsonId: string;

function adminContext(): AccessContext {
  return { actorUserId: ids.adminUser, requestId: "request:ai-structured-test" };
}

async function seedProvider(displayName: string): Promise<string> {
  const response = await server.inject({
    method: "POST",
    url: "/api/ai/providers",
    headers: { authorization: `Bearer ${ids.sessionAdmin}` },
    payload: {
      providerKind: "anthropic",
      displayName,
      credentialPayload: { apiKey: "structured-test-secret" }
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json().provider.id as string;
}

async function seedModel(
  providerConfigId: string,
  providerModelId: string,
  capabilities: readonly string[],
  tier: string
): Promise<string> {
  const response = await server.inject({
    method: "POST",
    url: "/api/ai/models",
    headers: { authorization: `Bearer ${ids.sessionAdmin}` },
    payload: { providerConfigId, providerModelId, displayName: providerModelId, capabilities, tier }
  });
  expect(response.statusCode).toBe(201);
  return response.json().model.id as string;
}

beforeAll(async () => {
  previousSecretKey = process.env.JARVIS_AI_SECRET_KEY;
  process.env.JARVIS_AI_SECRET_KEY = "test-ai-service-bindings-secret";

  realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network disabled in ai-structured tests");
  }) as typeof globalThis.fetch;

  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  dataContext = new DataContextRunner(appDb);
  repository = new AiRepository();
  server = createApiServer({ appDb, logger: false });
  await server.ready();

  providerId = await seedProvider("Structured Test Provider");
  const defaultResponse = await server.inject({
    method: "PUT",
    url: `/api/ai/providers/${providerId}/default`,
    headers: { authorization: `Bearer ${ids.sessionAdmin}` }
  });
  expect(defaultResponse.statusCode).toBe(200);

  modelEconomyJsonId = await seedModel(providerId, "json-economy", ["json"], "economy");
  modelReasoningJsonId = await seedModel(providerId, "json-reasoning", ["json"], "reasoning");
  modelChatJsonId = await seedModel(providerId, "chat-json", ["chat", "json"], "interactive");
});

afterAll(async () => {
  await Promise.allSettled([server?.close(), appDb?.destroy()]);
  globalThis.fetch = realFetch;
  if (previousSecretKey === undefined) delete process.env.JARVIS_AI_SECRET_KEY;
  else process.env.JARVIS_AI_SECRET_KEY = previousSecretKey;
});

describe("module service binding CRUD (repository)", () => {
  it("stores, lists, gets, and deletes module bindings without touching the chat binding", async () => {
    await dataContext.withDataContext(adminContext(), async (scopedDb) => {
      await repository.setServiceBinding(
        scopedDb,
        "chat",
        { kind: "mode", tier: "interactive" },
        ids.adminUser
      );
      await repository.setServiceBinding(
        scopedDb,
        "module.worker",
        { kind: "mode", tier: "economy" },
        ids.adminUser
      );
      await repository.setServiceBinding(
        scopedDb,
        "module.job-search",
        { kind: "model", modelId: modelEconomyJsonId },
        ids.adminUser
      );

      expect(await repository.listModuleServiceBindings(scopedDb)).toEqual({
        "module.worker": { kind: "mode", tier: "economy" },
        "module.job-search": { kind: "model", modelId: modelEconomyJsonId }
      });
      expect(await repository.getModuleServiceBinding(scopedDb, "module.worker")).toEqual({
        kind: "mode",
        tier: "economy"
      });
      expect(await repository.getServiceBinding(scopedDb, "chat")).toEqual({
        kind: "mode",
        tier: "interactive"
      });

      await repository.deleteModuleServiceBinding(scopedDb, "module.job-search", ids.adminUser);
      expect(await repository.getModuleServiceBinding(scopedDb, "module.job-search")).toBeNull();
      expect(await repository.getServiceBinding(scopedDb, "chat")).toEqual({
        kind: "mode",
        tier: "interactive"
      });

      await repository.deleteModuleServiceBinding(scopedDb, "module.worker", ids.adminUser);
    });
  });

  it("still rejects non-bindable worker capabilities", async () => {
    await dataContext.withDataContext(adminContext(), async (scopedDb) => {
      await expect(
        repository.setServiceBinding(
          scopedDb,
          "json" as never,
          { kind: "mode", tier: "economy" },
          ids.adminUser
        )
      ).rejects.toThrow(/not bindable/);
    });
  });
});

describe("resolveModelForService precedence", () => {
  const resolve = (service: `module.${string}`) =>
    dataContext.withDataContext(adminContext(), (scopedDb) =>
      repository.resolveModelForService(scopedDb, service, { capability: "json" })
    );

  it("unbound service resolves exactly like an automatic worker capability", async () => {
    const route = await resolve("module.job-search");
    expect(route.reason).toBe("matched-active-model");
    expect(route.model?.id).toBe(modelEconomyJsonId);
  });

  it("module.worker mode binding overrides the tier for every module", async () => {
    await dataContext.withDataContext(adminContext(), (scopedDb) =>
      repository.setServiceBinding(
        scopedDb,
        "module.worker",
        { kind: "mode", tier: "reasoning" },
        ids.adminUser
      )
    );
    const route = await resolve("module.job-search");
    expect(route.reason).toBe("matched-active-model");
    expect(route.model?.id).toBe(modelReasoningJsonId);
  });

  it("a module-specific model binding beats module.worker; other modules keep riding it", async () => {
    await dataContext.withDataContext(adminContext(), (scopedDb) =>
      repository.setServiceBinding(
        scopedDb,
        "module.job-search",
        { kind: "model", modelId: modelChatJsonId },
        ids.adminUser
      )
    );
    const specific = await resolve("module.job-search");
    expect(specific.reason).toBe("manual-route");
    expect(specific.model?.id).toBe(modelChatJsonId);

    const other = await resolve("module.other");
    expect(other.model?.id).toBe(modelReasoningJsonId);
  });

  it("a stale model binding is needs-config — never a silent fallthrough", async () => {
    const disable = await server.inject({
      method: "PATCH",
      url: `/api/ai/models/${modelChatJsonId}`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { status: "disabled" }
    });
    expect(disable.statusCode).toBe(200);

    const route = await resolve("module.job-search");
    expect(route.model).toBeNull();
    expect(route.reason).toBe("needs-config");

    const enable = await server.inject({
      method: "PATCH",
      url: `/api/ai/models/${modelChatJsonId}`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { status: "active" }
    });
    expect(enable.statusCode).toBe(200);
  });

  it("an admin model pin beats every module binding; cleanup restores automatic", async () => {
    await dataContext.withDataContext(adminContext(), async (scopedDb) => {
      await repository.setServiceBinding(
        scopedDb,
        "module.job-search",
        { kind: "model", modelId: modelEconomyJsonId },
        ids.adminUser
      );
      await repository.setAdminPinnedModel(scopedDb, modelChatJsonId);
    });

    const pinned = await resolve("module.job-search");
    expect(pinned.model?.id).toBe(modelChatJsonId);

    await dataContext.withDataContext(adminContext(), async (scopedDb) => {
      await repository.setAdminPinnedModel(scopedDb, null);
      await repository.deleteModuleServiceBinding(scopedDb, "module.job-search", ids.adminUser);
      await repository.deleteModuleServiceBinding(scopedDb, "module.worker", ids.adminUser);
    });
    const restored = await resolve("module.job-search");
    expect(restored.model?.id).toBe(modelEconomyJsonId);
  });
});

describe("module service binding routes", () => {
  const auth = { authorization: `Bearer ${ids.sessionAdmin}` };

  it("PUT + GET round-trip a module.worker binding (fjs must not strip module keys)", async () => {
    const put = await server.inject({
      method: "PUT",
      url: "/api/ai/services/module.worker/binding",
      headers: auth,
      payload: { binding: { kind: "mode", tier: "economy" } }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
      service: "module.worker",
      binding: { kind: "mode", tier: "economy" }
    });

    const list = await server.inject({
      method: "GET",
      url: "/api/ai/service-bindings",
      headers: auth
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().bindings["module.worker"]).toEqual({ kind: "mode", tier: "economy" });
  });

  it("rejects a module-specific binding for a module that is not installed", async () => {
    const put = await server.inject({
      method: "PUT",
      url: "/api/ai/services/module.definitely-not-installed/binding",
      headers: auth,
      payload: { binding: { kind: "mode", tier: "economy" } }
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().message ?? put.json().error).toMatch(/installed module/);
  });

  it("accepts a module-specific binding for an installed module", async () => {
    const put = await server.inject({
      method: "PUT",
      url: "/api/ai/services/module.ai/binding",
      headers: auth,
      payload: { binding: { kind: "mode", tier: "economy" } }
    });
    expect(put.statusCode).toBe(200);

    const del = await server.inject({
      method: "DELETE",
      url: "/api/ai/services/module.ai/binding",
      headers: auth
    });
    expect(del.statusCode).toBe(200);
  });

  it("rejects a model binding whose model lacks the json capability", async () => {
    const chatOnlyModelId = await seedModel(providerId, "chat-only", ["chat"], "interactive");
    const put = await server.inject({
      method: "PUT",
      url: "/api/ai/services/module.worker/binding",
      headers: auth,
      payload: { binding: { kind: "model", modelId: chatOnlyModelId } }
    });
    expect(put.statusCode).toBe(400);

    const chatPut = await server.inject({
      method: "PUT",
      url: "/api/ai/services/chat/binding",
      headers: auth,
      payload: { binding: { kind: "model", modelId: chatOnlyModelId } }
    });
    expect(chatPut.statusCode).toBe(200);
  });

  it("DELETE unbinds module keys only", async () => {
    const del = await server.inject({
      method: "DELETE",
      url: "/api/ai/services/module.worker/binding",
      headers: auth
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ service: "module.worker" });

    const list = await server.inject({
      method: "GET",
      url: "/api/ai/service-bindings",
      headers: auth
    });
    expect(list.json().bindings["module.worker"]).toBeUndefined();

    const chatDel = await server.inject({
      method: "DELETE",
      url: "/api/ai/services/chat/binding",
      headers: auth
    });
    expect(chatDel.statusCode).toBe(400);
  });

  it("requires auth and instance-admin", async () => {
    const anon = await server.inject({
      method: "PUT",
      url: "/api/ai/services/module.worker/binding",
      payload: { binding: { kind: "mode", tier: "economy" } }
    });
    expect(anon.statusCode).toBe(401);

    const nonAdmin = await server.inject({
      method: "PUT",
      url: "/api/ai/services/module.worker/binding",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { binding: { kind: "mode", tier: "economy" } }
    });
    expect(nonAdmin.statusCode).toBe(403);
  });
});

describe("generateStructured end-to-end", () => {
  it("resolves the service, decrypts the real credential, calls the adapter, validates", async () => {
    const captured: { apiKey?: string; input?: GenerateStructuredProviderInput } = {};
    const fakeAdapter = {
      generateStructured: async (input: GenerateStructuredProviderInput) => {
        captured.input = input;
        return {
          rawObject: { title: "Staff Engineer" },
          usage: { inputTokens: 11, outputTokens: 7 }
        };
      }
    };

    const result = await dataContext.withDataContext(adminContext(), (scopedDb) =>
      generateStructured(
        scopedDb,
        {
          service: "module.job-search",
          prompt: "Extract the job title.",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["title"],
            properties: { title: { type: "string" } }
          }
        },
        {
          repository,
          cipher: createAiSecretCipher(process.env),
          createAdapter: (kind, apiKey) => {
            captured.apiKey = apiKey;
            expect(kind).toBe("anthropic");
            return fakeAdapter;
          }
        }
      )
    );

    expect(result).toEqual({
      ok: true,
      object: { title: "Staff Engineer" },
      usage: { inputTokens: 11, outputTokens: 7 }
    });
    expect(captured.apiKey).toBe("structured-test-secret");
    expect(captured.input?.model.provider_model_id).toBe("json-economy");
    expect(captured.input?.messages).toEqual([{ role: "user", content: "Extract the job title." }]);
  });
});
