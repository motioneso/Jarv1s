import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";

import type { AccessContext, ChatThread, DataContextRunner } from "@jarv1s/db";
import { listChatThreadsRouteSchema, type ChatThreadDto } from "@jarv1s/shared";
import {
  AiRepository,
  AssistantToolGateway,
  ConfirmationRegistry,
  SessionTokenRegistry,
  type ActiveModulesResolver,
  type GatewaySessionRecord,
  type SessionNotifier
} from "@jarv1s/ai";
import { ChatMemoryFactsRepository, type MemoryFact } from "@jarv1s/memory";

import { ChatGatewayNotifier } from "./gateway-notifier.js";
import { registerChatLiveRoutes } from "./live-routes.js";
import { createChatSessionRuntime, type ChatEngineFactory } from "./live/runtime.js";
import {
  ChatUserMemorySettingsRepository,
  type UserMemorySettings
} from "./memory-settings-repository.js";
import { registerMcpTransportRoute } from "./mcp-transport.js";
import { ChatRepository } from "./repository.js";

export interface ChatRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: ChatRepository;
  /** Override the live-chat engine factory (tests inject a fake); defaults to real tmux. */
  readonly chatEngineFactory?: ChatEngineFactory;
  readonly resolveActiveModules?: ActiveModulesResolver;
  readonly mcpServerUrl?: string;
  /** pg-boss for enqueueing embed/extract-facts jobs after each completed turn. */
  readonly boss?: PgBoss;
}

/**
 * Chat HTTP routes. The live drawer is the only chat surface: the in-process CLI
 * runtime (turn/clear/switch/stream) plus a read-only thread list for the drawer's
 * History. The legacy worker-backed thread/message CRUD was removed in the
 * retire-legacy-chat-model change.
 *
 * Phase 2: when resolveActiveModules + mcpServerUrl are supplied, also wires the
 * AssistantToolGateway (MCP transport + approve/deny endpoint).
 */
export function registerChatRoutes(
  server: FastifyInstance,
  dependencies: ChatRoutesDependencies
): void {
  const repository = dependencies.repository ?? new ChatRepository();
  const memorySettingsRepo = new ChatUserMemorySettingsRepository();
  const factsRepo = new ChatMemoryFactsRepository();

  // Phase 2: proxy notifier — created before gateway so the gateway has a notifier
  // reference; real target is set after the manager is created.
  const notifierProxy: SessionNotifier = {
    emit(chatSessionId: string, record: GatewaySessionRecord) {
      realNotifier?.emit(chatSessionId, record);
    }
  };
  let realNotifier: ChatGatewayNotifier | null = null;

  let tokens: SessionTokenRegistry | undefined;
  let gateway: AssistantToolGateway | undefined;

  if (dependencies.resolveActiveModules && dependencies.mcpServerUrl) {
    tokens = new SessionTokenRegistry();
    const confirmations = new ConfirmationRegistry();
    const aiRepository = new AiRepository();

    gateway = new AssistantToolGateway({
      resolveActiveModules: dependencies.resolveActiveModules,
      repository: aiRepository,
      runner: dependencies.dataContext,
      tokens,
      confirmations,
      notifier: notifierProxy,
      confirmTimeoutMs: 150_000
    });
  }

  const mcpServerUrl = dependencies.mcpServerUrl;
  const runtime = createChatSessionRuntime({
    dataContext: dependencies.dataContext,
    engineFactory: dependencies.chatEngineFactory,
    boss: dependencies.boss,
    mcpTokenLifecycle:
      tokens && mcpServerUrl
        ? {
            mint: (actorUserId: string) => ({
              token: tokens!.mint({ actorUserId, chatSessionId: actorUserId }),
              mcpServerUrl
            }),
            revoke: (chatSessionId: string) => tokens!.revokeBySessionId(chatSessionId)
          }
        : undefined
  });

  // Wire real notifier now that manager is available.
  realNotifier = new ChatGatewayNotifier(runtime.manager);

  if (gateway && tokens) {
    registerMcpTransportRoute(server, { gateway, tokens });

    server.post<{ Params: { id: string }; Body: { status: string } }>(
      "/api/chat/action-requests/:id/resolve",
      async (request, reply) => {
        let access: AccessContext;
        try {
          access = await dependencies.resolveAccessContext(request);
        } catch {
          return reply.code(401).send({ error: "Session is missing or expired" });
        }

        const { id } = request.params;
        const rawStatus = (request.body as { status?: unknown }).status;
        if (rawStatus !== "confirmed" && rawStatus !== "rejected" && rawStatus !== "cancelled") {
          return reply
            .code(400)
            .send({ error: "status must be confirmed, rejected, or cancelled" });
        }

        try {
          await gateway!.resolveActionRequest(access.actorUserId, id, rawStatus);
          return reply.code(204).send();
        } catch {
          return reply.code(400).send({ error: "Could not resolve action request" });
        }
      }
    );
  }

  registerChatLiveRoutes(server, {
    resolveAccessContext: dependencies.resolveAccessContext,
    runtime
  });

  server.get(
    "/api/chat/threads",
    { schema: listChatThreadsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const threads = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listThreads(scopedDb)
        );
        return { threads: threads.map(serializeThread) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  // ── Memory settings ────────────────────────────────────────────────────────

  server.get("/api/chat/memory/settings", async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const settings = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        memorySettingsRepo.getOrCreate(scopedDb, access.actorUserId)
      );
      return serializeSettings(settings);
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.patch("/api/chat/memory/settings", async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const patch = parseSettingsPatch(request.body);
      const settings = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        memorySettingsRepo.update(scopedDb, access.actorUserId, patch)
      );
      return serializeSettings(settings);
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  // ── Memory facts ───────────────────────────────────────────────────────────

  server.get("/api/chat/memory/facts", async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const facts = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        factsRepo.listActiveFacts(scopedDb, access.actorUserId)
      );
      return { facts: facts.map(serializeFact) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.delete<{ Params: { id: string } }>("/api/chat/memory/facts/:id", async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        factsRepo.deleteFact(scopedDb, request.params.id)
      );
      return reply.code(204).send();
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.patch<{ Params: { id: string } }>("/api/chat/memory/facts/:id", async (request, reply) => {
    try {
      const access = await dependencies.resolveAccessContext(request);
      const importance = (request.body as Record<string, unknown>).importance;
      if (typeof importance !== "number" || importance < 0 || importance > 1) {
        return reply.code(400).send({ error: "importance must be a number between 0 and 1" });
      }
      await dependencies.dataContext.withDataContext(access, (scopedDb) =>
        factsRepo.updateFactImportance(scopedDb, request.params.id, importance)
      );
      return reply.code(204).send();
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });
}

function serializeThread(thread: ChatThread): ChatThreadDto {
  return {
    id: thread.id,
    ownerUserId: thread.owner_user_id,
    title: thread.title,
    createdAt: toIsoString(thread.created_at),
    updatedAt: toIsoString(thread.updated_at)
  };
}

function serializeSettings(s: UserMemorySettings) {
  return {
    recallEnabled: s.recallEnabled,
    factsEnabled: s.factsEnabled,
    updatedAt: toIsoString(s.updatedAt)
  };
}

function serializeFact(f: MemoryFact) {
  return {
    id: f.id,
    category: f.category,
    content: f.content,
    importance: f.importance,
    sourceThreadId: f.sourceThreadId,
    createdAt: toIsoString(f.createdAt)
  };
}

function parseSettingsPatch(body: unknown): { recallEnabled?: boolean; factsEnabled?: boolean } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const b = body as Record<string, unknown>;
  const patch: { recallEnabled?: boolean; factsEnabled?: boolean } = {};
  if (typeof b.recallEnabled === "boolean") patch.recallEnabled = b.recallEnabled;
  if (typeof b.factsEnabled === "boolean") patch.factsEnabled = b.factsEnabled;
  return patch;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error) {
    if (error.message === "Session is missing or expired") {
      return reply.code(401).send({ error: error.message });
    }
    if (error.message === "Invalid bearer token") {
      return reply.code(401).send({ error: error.message });
    }
    if (
      error.message.includes("foreign key") ||
      error.message.includes("violates row-level security policy")
    ) {
      return reply.code(400).send({ error: "Chat request is invalid" });
    }
  }

  throw error;
}
