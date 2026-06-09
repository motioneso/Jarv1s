/**
 * Live-chat HTTP/SSE routes: drive the in-process ChatSessionManager rather than
 * the pg-boss worker. Every handler resolves the AccessContext first (401 when the
 * session is missing/expired) and only ever acts on the caller's own actorUserId —
 * the manager keys sessions and subscriptions by actor, so there is no cross-user
 * path (a user can only stream their own transcript).
 *
 * Handler bodies are wrapped in try/catch and mapped through handleLiveRouteError:
 * known configuration/launch failures become a sanitized 4xx (no active model →
 * 400, unsupported/launch-not-supported provider → 400, turn-already-in-flight →
 * 409), and any unexpected error becomes a generic 500 — raw error strings/stacks
 * are never returned to the client.
 *
 *   POST /api/chat/turn    { text }  → { reply }   submit one user turn
 *   POST /api/chat/clear             → 204         reset history + new conversation
 *   POST /api/chat/switch            → 200         re-launch on the now-active provider
 *   GET  /api/chat/stream            → SSE         live transcript records for the actor
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext } from "@jarv1s/db";

import { ChatTurnInFlightError } from "./live/chat-session-manager.js";
import type { ChatSessionRuntime } from "./live/runtime.js";

export interface ChatLiveRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly runtime: ChatSessionRuntime;
}

export function registerChatLiveRoutes(
  server: FastifyInstance,
  dependencies: ChatLiveRoutesDependencies
): void {
  const { runtime } = dependencies;

  server.post("/api/chat/turn", async (request, reply) => {
    const access = await resolveOr401(dependencies, request, reply);
    if (!access) return reply;

    const text = readText(request.body);
    if (text === undefined) {
      return reply.code(400).send({ error: "text is required" });
    }

    try {
      const userName = await runtime.resolveUserName(access.actorUserId);
      const { reply: assistantReply } = await runtime.manager.submitTurn(
        access.actorUserId,
        userName,
        text
      );

      return reply.send({ reply: assistantReply });
    } catch (error) {
      return handleLiveRouteError(error, reply);
    }
  });

  server.post("/api/chat/clear", async (request, reply) => {
    const access = await resolveOr401(dependencies, request, reply);
    if (!access) return reply;

    try {
      const rawIncognito = (request.query as Record<string, unknown>).incognito;
      const incognito = rawIncognito === "true" || rawIncognito === "1";
      await runtime.manager.clear(access.actorUserId, incognito ? { incognito: true } : undefined);

      return reply.code(204).send();
    } catch (error) {
      return handleLiveRouteError(error, reply);
    }
  });

  server.post("/api/chat/switch", async (request, reply) => {
    const access = await resolveOr401(dependencies, request, reply);
    if (!access) return reply;

    try {
      const userName = await runtime.resolveUserName(access.actorUserId);
      await runtime.manager.switchProvider(access.actorUserId, userName);

      return reply.code(200).send({ ok: true });
    } catch (error) {
      return handleLiveRouteError(error, reply);
    }
  });

  server.get("/api/chat/stream", async (request, reply) => {
    const access = await resolveOr401(dependencies, request, reply);
    if (!access) return reply;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    // Subscriptions are keyed by the caller's actorUserId — a stream only ever
    // receives that actor's transcript records, never another user's.
    const unsubscribe = runtime.manager.subscribe(access.actorUserId, (record) => {
      reply.raw.write(`data: ${JSON.stringify(record)}\n\n`);
    });

    request.raw.on("close", () => {
      unsubscribe();
      reply.raw.end();
    });

    // Keep the Fastify handler open until the client disconnects.
    return reply;
  });
}

/**
 * Resolve the AccessContext or send a 401 and return undefined. Mirrors the REST
 * chat routes' "session missing/expired → 401" behaviour.
 */
async function resolveOr401(
  dependencies: ChatLiveRoutesDependencies,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AccessContext | undefined> {
  try {
    return await dependencies.resolveAccessContext(request);
  } catch {
    reply.code(401).send({ error: "Session is missing or expired" });
    return undefined;
  }
}

/**
 * Map a thrown live-handler error to a sanitized client response. Known
 * configuration/launch failures become 4xx with a stable client message;
 * anything unexpected becomes a generic 500 so raw error strings/stacks never
 * leak to the client. Mirrors the REST chat routes' handleRouteError contract.
 */
function handleLiveRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof ChatTurnInFlightError) {
    return reply
      .code(409)
      .send({ error: "A chat turn is already in progress. Please wait for it to finish." });
  }

  if (error instanceof Error) {
    const message = error.message;
    // No active chat-capable model is configured for this user.
    if (/no active chat-capable model/i.test(message)) {
      return reply.code(400).send({ error: "No active chat-capable model is configured." });
    }
    // Unsupported provider kind, or a CLI engine that isn't supported yet.
    if (/not yet supported|unsupported provider/i.test(message)) {
      return reply
        .code(400)
        .send({ error: "The active chat provider is not supported in this build." });
    }
  }

  // Unexpected error: do not leak the raw message/stack.
  reply.log?.error?.({ err: error }, "live chat route failed");
  return reply.code(500).send({ error: "Live chat is temporarily unavailable." });
}

function readText(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>).text;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
