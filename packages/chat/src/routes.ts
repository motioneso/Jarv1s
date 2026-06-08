import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, ChatThread, DataContextRunner } from "@jarv1s/db";
import { listChatThreadsRouteSchema, type ChatThreadDto } from "@jarv1s/shared";

import { registerChatLiveRoutes } from "./live-routes.js";
import { createChatSessionRuntime, type ChatEngineFactory } from "./live/runtime.js";
import { ChatRepository } from "./repository.js";

export interface ChatRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: ChatRepository;
  /** Override the live-chat engine factory (tests inject a fake); defaults to real tmux. */
  readonly chatEngineFactory?: ChatEngineFactory;
}

/**
 * Chat HTTP routes. The live drawer is the only chat surface: the in-process CLI
 * runtime (turn/clear/switch/stream) plus a read-only thread list for the drawer's
 * History. The legacy worker-backed thread/message CRUD was removed in the
 * retire-legacy-chat-model change.
 */
export function registerChatRoutes(
  server: FastifyInstance,
  dependencies: ChatRoutesDependencies
): void {
  const repository = dependencies.repository ?? new ChatRepository();

  // Live-chat runtime (in-process CLI engine + DataContext persistence). The engine
  // factory is injectable so integration tests can swap in a fake (no real tmux).
  const runtime = createChatSessionRuntime({
    dataContext: dependencies.dataContext,
    engineFactory: dependencies.chatEngineFactory
  });
  registerChatLiveRoutes(server, {
    resolveAccessContext: dependencies.resolveAccessContext,
    runtime
  });

  // Read-only thread list backing the drawer's History.
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
