/**
 * Integration tests for the live-chat HTTP/SSE API (Task 8).
 *
 * A FAKE engine factory is injected into createApiServer so no real tmux / `claude`
 * binary is touched. The fake engine serves a scripted reply per turn; the tests
 * assert the route persists a stored user+assistant turn, that an unauthenticated
 * turn is 401, and that the manager subscription is strictly per-actor (no
 * cross-user transcript leakage).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { ChatRepository, CliChatUnavailableError } from "@jarv1s/chat";
import type { ChatEngineFactory } from "@jarv1s/module-registry";
import {
  DataContextRunner,
  SharesRepository,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import type {
  CliChatEngine,
  EngineLaunchOpts,
  TranscriptRecord
} from "../../packages/chat/src/live/types.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

/**
 * Fake live engine: launch/submit are no-ops; readNew returns a single scripted
 * reply + complete on the first call after each submit.
 */
class FakeLiveEngine implements CliChatEngine {
  private pending: TranscriptRecord[] = [];

  constructor(
    public readonly provider: CliChatEngine["provider"],
    private readonly sessionKey: string
  ) {}

  async launch(_opts: EngineLaunchOpts): Promise<void> {}

  async submit(text: string): Promise<void> {
    this.pending = [{ kind: "reply", text: `echo:${text}` }];
  }

  async readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    if (this.pending.length === 0) {
      return { records: [], offset: afterOffset, complete: false };
    }
    const records = this.pending;
    this.pending = [];
    return { records, offset: afterOffset + 1, complete: true };
  }

  async isAlive(): Promise<boolean> {
    return true;
  }

  async kill(): Promise<void> {}
}

const fakeEngineFactory: ChatEngineFactory = (provider, sessionKey) =>
  new FakeLiveEngine(provider, sessionKey);

describe("Chat live API (turn / clear / switch / stream)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: ChatRepository;
  let shares: SharesRepository;
  let server: ReturnType<typeof createApiServer>;
  let originalSecretKey: string | undefined;
  let providerId: string;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    process.env.JARVIS_AI_SECRET_KEY = "test-chat-live-api-secret-key";

    await resetFoundationDatabase();

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new ChatRepository();
    shares = new SharesRepository();
    server = createApiServer({
      appDb,
      logger: false,
      chatEngineFactory: fakeEngineFactory
    });
    await server.ready();

    // Seed an active chat-capable model for userA so resolveActiveProvider succeeds.
    const providerResponse = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { providerKind: "anthropic", displayName: "Live API Provider", authMethod: "cli" }
    });
    providerId = providerResponse.json<{ provider: { id: string } }>().provider.id;
    await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerConfigId: providerId,
        providerModelId: "claude-live",
        displayName: "Claude Live",
        capabilities: ["chat"]
      }
    });
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_AI_SECRET_KEY;
    } else {
      process.env.JARVIS_AI_SECRET_KEY = originalSecretKey;
    }
  });

  it("POST /api/chat/turn returns a reply and persists a stored user+assistant turn", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/chat/turn",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { text: "hello jarvis" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ reply: string }>().reply).toBe("echo:hello jarvis");

    // The turn is persisted as a stored user + stored assistant message in the
    // user's current conversation (no pg-boss job, born complete).
    const messages = await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.getCurrentThread(scopedDb, ids.userA);
      expect(thread).toBeDefined();
      return repository.listMessages(scopedDb, thread!.id);
    });

    const stored = messages.filter((m) => m.status === "stored");
    const user = stored.find((m) => m.role === "user");
    const assistant = stored.find((m) => m.role === "assistant");

    expect(user?.body).toBe("hello jarvis");
    expect(assistant?.body).toBe("echo:hello jarvis");
    const metadata = assistant?.model_metadata as { executed?: { provider: string } };
    expect(metadata.executed?.provider).toBe("anthropic");
  });

  it("POST /api/chat/turn uses the user's allowed chat model override when enabled", async () => {
    const overrideModel = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerConfigId: providerId,
        providerModelId: "claude-override",
        displayName: "Claude Override",
        capabilities: ["chat"],
        tier: "economy"
      }
    });
    const overrideId = overrideModel.json<{ model: { id: string } }>().model.id;

    const enabled = await server.inject({
      method: "PUT",
      url: "/api/admin/ai/chat-model-override",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { enabled: true }
    });
    const saved = await server.inject({
      method: "PUT",
      url: "/api/ai/chat-model-override",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { modelId: overrideId }
    });
    await server.inject({
      method: "POST",
      url: "/api/chat/switch",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    const overrideTurn = await server.inject({
      method: "POST",
      url: "/api/chat/turn",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { text: "override model" }
    });

    const disabled = await server.inject({
      method: "PUT",
      url: "/api/admin/ai/chat-model-override",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { enabled: false }
    });
    await server.inject({
      method: "POST",
      url: "/api/chat/switch",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    const defaultTurn = await server.inject({
      method: "POST",
      url: "/api/chat/turn",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { text: "default model" }
    });

    const messages = await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.getCurrentThread(scopedDb, ids.userA);
      expect(thread).toBeDefined();
      return repository.listMessages(scopedDb, thread!.id);
    });
    const overrideAssistant = messages.find(
      (m) => m.role === "assistant" && m.body === "echo:override model"
    );
    const defaultAssistant = messages.find(
      (m) => m.role === "assistant" && m.body === "echo:default model"
    );
    const overrideMetadata = overrideAssistant?.model_metadata as {
      executed?: { model?: string };
    };
    const defaultMetadata = defaultAssistant?.model_metadata as {
      executed?: { model?: string };
    };

    expect(overrideModel.statusCode).toBe(201);
    expect(enabled.statusCode).toBe(200);
    expect(saved.statusCode).toBe(200);
    expect(overrideTurn.statusCode).toBe(200);
    expect(overrideMetadata.executed?.model).toBe("claude-override");
    expect(disabled.statusCode).toBe(200);
    expect(defaultTurn.statusCode).toBe(200);
    expect(defaultMetadata.executed?.model).toBe("claude-live");
  });

  it("POST /api/chat/turn without a session returns 401", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/chat/turn",
      payload: { text: "no auth" }
    });

    expect(response.statusCode).toBe(401);
  });

  it("POST /api/chat/turn lets another user use the admin-configured instance default", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/chat/turn",
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { text: "hello from user b" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ reply: string }>().reply).toBe("echo:hello from user b");
  });

  it("GET /api/chat/threads/:id/messages returns only the owner's stored thread messages", async () => {
    const thread = await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const created = await repository.openNewThread(scopedDb, { title: "Historical thread" });
      await repository.recordCompletedTurn(scopedDb, created.id, "old question", "old answer", {
        provider: "anthropic",
        model: "claude-live"
      });
      return created;
    });

    const owner = await server.inject({
      method: "GET",
      url: `/api/chat/threads/${thread.id}/messages`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    const other = await server.inject({
      method: "GET",
      url: `/api/chat/threads/${thread.id}/messages`,
      headers: { authorization: `Bearer ${ids.sessionB}` }
    });

    expect(owner.statusCode).toBe(200);
    expect(owner.json<{ messages: Array<{ body: string; role: string }> }>().messages).toEqual([
      expect.objectContaining({ role: "user", body: "old question" }),
      expect.objectContaining({ role: "assistant", body: "old answer" })
    ]);
    expect(other.statusCode).toBe(404);
  });

  it("GET /api/chat/threads/:id/messages returns 404 for a shared thread grantee", async () => {
    const thread = await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const created = await repository.openNewThread(scopedDb, {
        title: "Shared historical thread"
      });
      await repository.recordCompletedTurn(
        scopedDb,
        created.id,
        "shared question",
        "shared answer",
        {
          provider: "anthropic",
          model: "claude-live"
        }
      );
      await shares.grant(scopedDb, {
        resourceType: "chat_thread",
        resourceId: created.id,
        ownerUserId: ids.userA,
        granteeUserId: ids.userB,
        level: "view"
      });
      return created;
    });

    const response = await server.inject({
      method: "GET",
      url: `/api/chat/threads/${thread.id}/messages`,
      headers: { authorization: `Bearer ${ids.sessionB}` }
    });

    expect(response.statusCode).toBe(404);
  });

  it("subscriptions are per-actor: user B's stream never receives user A's records", async () => {
    // Access the live runtime's manager directly via a second server instance that
    // shares the same DB but its own manager — instead, assert against the manager
    // behaviour: subscribe as B, run a turn as A, B sees nothing.
    //
    // We exercise this through the public manager API by reaching the runtime that
    // the routes built. The simplest deterministic assertion: subscribe two actors
    // and confirm records only fan out to the matching actor.
    const { createChatSessionRuntime } = await import("@jarv1s/chat");
    const runtime = createChatSessionRuntime({
      dataContext,
      engineFactory: fakeEngineFactory
    });

    const aRecords: TranscriptRecord[] = [];
    const bRecords: TranscriptRecord[] = [];
    const unsubA = runtime.manager.subscribe(ids.userA, (r) => aRecords.push(r));
    const unsubB = runtime.manager.subscribe(ids.userB, (r) => bRecords.push(r));

    try {
      await runtime.manager.submitTurn(ids.userA, "User A", "private to A");
    } finally {
      unsubA();
      unsubB();
    }

    // A received its own records (at least the echoed user + reply); B received none.
    expect(aRecords.length).toBeGreaterThan(0);
    expect(bRecords).toHaveLength(0);
  });
});

describe("Chat live API — no multiplexer available", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    process.env.JARVIS_AI_SECRET_KEY = "test-chat-live-api-secret-key";

    await resetFoundationDatabase();

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    server = createApiServer({
      appDb,
      logger: false,
      // A factory that refuses to launch — mirrors a host with no tmux/herdr installed.
      chatEngineFactory: () => {
        throw new CliChatUnavailableError("no terminal multiplexer (tmux/herdr) installed");
      }
    });
    await server.ready();

    // Seed an active chat-capable model for userA so resolveActiveProvider succeeds
    // and the failure surfaces at engine-launch (503), not at provider resolution.
    const providerResponse = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { providerKind: "anthropic", displayName: "Live API Provider", authMethod: "cli" }
    });
    const providerId = providerResponse.json<{ provider: { id: string } }>().provider.id;
    await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerConfigId: providerId,
        providerModelId: "claude-live",
        displayName: "Claude Live",
        capabilities: ["chat"]
      }
    });
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_AI_SECRET_KEY;
    } else {
      process.env.JARVIS_AI_SECRET_KEY = originalSecretKey;
    }
  });

  it("returns 503 when no multiplexer is available", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/chat/turn",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { text: "hello jarvis" }
    });
    expect(res.statusCode).toBe(503);
  });
});

function userAContext(): AccessContext {
  return { actorUserId: ids.userA, requestId: "request:chat-live-api-a" };
}
