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
 *   POST /api/chat/turn/cancel      → 200          stop the in-flight turn (#456)
 *   POST /api/chat/clear             → 204         reset history + new conversation
 *   POST /api/chat/private/end       → 204         end private session bookkeeping
 *   GET  /api/chat/privacy           → { incognito } server-truth privacy state for restore-on-mount
 *   POST /api/chat/switch            → 200         re-launch on the now-active provider
 *   GET  /api/chat/stream            → SSE         live transcript records for the actor
 *
 * Rate limiting: POST /api/chat/turn is throttled per session principal (per user on a
 * LAN multi-user deployment). Limit: JARVIS_RL_CHAT_MAX requests per minute
 * (default 20). Only a UUID-shaped session bearer or a valid session cookie earns a
 * per-principal bucket; any other bearer shape (or none) falls back to the shared per-IP
 * bucket so junk-credential abuse cannot mint fresh buckets (#207) and is still capped.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext } from "@jarv1s/db";
import { sessionRateLimitKey } from "@jarv1s/module-sdk";
import {
  type GetChatPrivacyStateResponse,
  getChatPrivacyStateRouteSchema,
  parsePositiveIntEnv
} from "@jarv1s/shared";

import {
  type ChatAttachmentsService,
  isAttachmentId,
  MAX_ATTACHMENTS_PER_TURN,
  type StoredAttachmentMeta
} from "./attachments-service.js";
import {
  ChatStreamLimitError,
  ChatThreadNotFoundError,
  ChatTurnInFlightError
} from "./live/chat-session-manager.js";
import { CliChatUnavailableError } from "./live/errors.js";
import type { PageContextStore } from "./live/page-context-store.js";
import type { ChatSessionRuntime } from "./live/runtime.js";

// Per-user rate-limit key via the shared module-sdk helper: a UUID-shaped session bearer or
// a valid session cookie is hashed (a one-way fingerprint, never the raw secret) to a
// per-principal bucket; any other bearer shape (or none) falls back to the shared per-IP
// bucket so junk-credential abuse can't mint buckets (#207) and is still capped (the handler
// 401s before any AI spend).
//
// Override the limit via env: JARVIS_RL_CHAT_MAX=<n> (requests per minute, default 20).
const CHAT_MAX = parsePositiveIntEnv(process.env.JARVIS_RL_CHAT_MAX, 20);
const CHAT_MUTATION_MAX = parsePositiveIntEnv(process.env.JARVIS_RL_CHAT_MUTATION_MAX, 20);
const MAX_CHAT_TURN_TEXT_LENGTH = 32_000;

export interface EveningInterviewSeed {
  readonly context: string;
  readonly openingPrompt: string;
}

export interface ChatLiveRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly runtime: ChatSessionRuntime & {
    readonly resolveEveningInterviewSeed?: (
      actorUserId: string,
      briefingRunId?: string
    ) => Promise<EveningInterviewSeed>;
  };
  /** #1109 — TTL-backed store the pull-based chat.getCurrentView tool reads from. */
  readonly pageContextStore: PageContextStore;
  /**
   * #1133 — resolves uploaded attachment ids to vault-backed metadata for /turn.
   * Optional so existing structural runtime stubs in tests keep compiling; when
   * absent, any turn carrying attachmentIds is rejected with a 400.
   */
  readonly attachmentsService?: ChatAttachmentsService;
}

export function registerChatLiveRoutes(
  server: FastifyInstance,
  dependencies: ChatLiveRoutesDependencies
): void {
  const { runtime } = dependencies;

  server.post(
    "/api/chat/turn",
    {
      config: {
        rateLimit: {
          max: CHAT_MAX,
          timeWindow: "1 minute",
          keyGenerator: sessionRateLimitKey
        }
      }
    },
    async (request, reply) => {
      const access = await resolveOr401(dependencies, request, reply);
      if (!access) return reply;

      const bodyResult = readTurnBody(request.body);
      if ("error" in bodyResult) {
        return reply.code(400).send({ error: bodyResult.error });
      }
      const { text, attachmentIds } = bodyResult;

      try {
        // #1133 — resolve attachment ids to vault-backed metadata before the turn
        // starts. Ownership is structural (the service reads the caller's own vault),
        // so an id belonging to another user simply fails to resolve → 400.
        let attachments: StoredAttachmentMeta[] | undefined;
        if (attachmentIds.length > 0) {
          const service = dependencies.attachmentsService;
          if (!service) {
            return reply.code(400).send({ error: "Attachments are not available." });
          }
          // Server-side guard mirroring the hidden composer button: private/incognito
          // turns must never reference vault files (the thread leaves no record that
          // could explain the attachment later).
          const privacy = await runtime.manager.getPrivacyState(access.actorUserId);
          if (privacy.incognito) {
            return reply
              .code(400)
              .send({ error: "Attachments are not available in private chat." });
          }
          const metas: StoredAttachmentMeta[] = [];
          for (const id of attachmentIds) {
            const meta = await service.getMeta(access, id);
            if (!meta) {
              return reply
                .code(400)
                .send({ error: "Attachment not found. Please re-attach the file." });
            }
            metas.push(meta);
          }
          // Stamp sentAt before submitting so the lazy GC never reaps a file the
          // engine may still read mid-turn.
          await service.markSent(access, attachmentIds);
          attachments = metas;
        }

        const userName = await runtime.resolveUserName(access.actorUserId);
        const {
          reply: assistantReply,
          userMessageId,
          assistantMessageId,
          sourceFreshness
        } = await runtime.manager.submitTurn(
          access.actorUserId,
          userName,
          text,
          attachments ? { attachments } : undefined
        );

        return reply.send({
          reply: assistantReply,
          userMessageId,
          assistantMessageId,
          sourceFreshness
        });
      } catch (error) {
        return handleLiveRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/chat/clear",
    {
      config: {
        rateLimit: {
          max: CHAT_MUTATION_MAX,
          timeWindow: "1 minute",
          keyGenerator: sessionRateLimitKey
        }
      }
    },
    async (request, reply) => {
      const access = await resolveOr401(dependencies, request, reply);
      if (!access) return reply;

      try {
        const rawIncognito = (request.query as Record<string, unknown>).incognito;
        const incognito = rawIncognito === "true" || rawIncognito === "1";
        await runtime.manager.clear(
          access.actorUserId,
          incognito ? { incognito: true } : undefined
        );

        return reply.code(204).send();
      } catch (error) {
        return handleLiveRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/chat/private/end",
    {
      config: {
        rateLimit: {
          max: CHAT_MUTATION_MAX,
          timeWindow: "1 minute",
          keyGenerator: sessionRateLimitKey
        }
      }
    },
    async (request, reply) => {
      const access = await resolveOr401(dependencies, request, reply);
      if (!access) return reply;

      try {
        await runtime.manager.endPrivateSession(access.actorUserId);
        return reply.code(204).send();
      } catch (error) {
        return handleLiveRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/chat/privacy",
    { schema: getChatPrivacyStateRouteSchema },
    async (request, reply) => {
      const access = await resolveOr401(dependencies, request, reply);
      if (!access) return reply;

      try {
        const state = await runtime.manager.getPrivacyState(access.actorUserId);
        return state satisfies GetChatPrivacyStateResponse;
      } catch (error) {
        return handleLiveRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/chat/switch",
    {
      config: {
        rateLimit: {
          max: CHAT_MUTATION_MAX,
          timeWindow: "1 minute",
          keyGenerator: sessionRateLimitKey
        }
      }
    },
    async (request, reply) => {
      const access = await resolveOr401(dependencies, request, reply);
      if (!access) return reply;

      try {
        const userName = await runtime.resolveUserName(access.actorUserId);
        await runtime.manager.switchProvider(access.actorUserId, userName);

        return reply.code(200).send({ ok: true });
      } catch (error) {
        return handleLiveRouteError(error, reply);
      }
    }
  );

  // #456 — user-driven Stop. Ends an in-flight turn cleanly (kill engine, release turn lock,
  // emit a 'Stopped by user.' status record over SSE). Idempotent: 200 even when no turn is in
  // flight. Payload carries no content (session is implied by the authenticated actor); honors
  // the metadata-only invariant (no user content crosses this boundary).
  server.post(
    "/api/chat/turn/cancel",
    {
      config: {
        rateLimit: {
          max: CHAT_MUTATION_MAX,
          timeWindow: "1 minute",
          keyGenerator: sessionRateLimitKey
        }
      }
    },
    async (request, reply) => {
      const access = await resolveOr401(dependencies, request, reply);
      if (!access) return reply;

      try {
        await runtime.manager.stopTurn(access.actorUserId);
        return reply.code(200).send({ ok: true });
      } catch (error) {
        return handleLiveRouteError(error, reply);
      }
    }
  );

  // Resume a past thread: makes it the current thread so the next /turn reply draws on its context.
  server.post(
    "/api/chat/threads/:id/resume",
    {
      config: {
        rateLimit: {
          max: CHAT_MUTATION_MAX,
          timeWindow: "1 minute",
          keyGenerator: sessionRateLimitKey
        }
      }
    },
    async (request, reply) => {
      const access = await resolveOr401(dependencies, request, reply);
      if (!access) return reply;

      const { id: threadId } = request.params as { id: string };
      if (!threadId || typeof threadId !== "string") {
        return reply.code(400).send({ error: "Missing thread id" });
      }

      try {
        await runtime.manager.resumeThread(access.actorUserId, threadId);
        return reply.code(204).send();
      } catch (error) {
        return handleLiveRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/chat/evening-interview",
    {
      config: {
        rateLimit: {
          max: CHAT_MUTATION_MAX,
          timeWindow: "1 minute",
          keyGenerator: sessionRateLimitKey
        }
      }
    },
    async (request, reply) => {
      const access = await resolveOr401(dependencies, request, reply);
      if (!access) return reply;

      const bodyResult = readEveningInterviewBody(request.body);
      if ("error" in bodyResult) {
        return reply.code(400).send({ error: bodyResult.error });
      }

      try {
        const userName = await runtime.resolveUserName(access.actorUserId);
        const seed =
          (await runtime.resolveEveningInterviewSeed?.(
            access.actorUserId,
            bodyResult.briefingRunId
          )) ?? buildEveningInterviewSeed(null);
        await runtime.manager.seedContext(access.actorUserId, userName, seed.context);
        const {
          reply: assistantReply,
          userMessageId,
          assistantMessageId
        } = await runtime.manager.submitTurn(access.actorUserId, userName, seed.openingPrompt);

        return reply.send({ reply: assistantReply, userMessageId, assistantMessageId });
      } catch (error) {
        return handleLiveRouteError(error, reply);
      }
    }
  );

  // #1109 — client PUTs its current view here (debounced, on navigation/change); an AI tool
  // pulls it on demand rather than the client pushing it on every chat turn.
  server.put(
    "/api/chat/page-context",
    {
      config: {
        rateLimit: {
          max: CHAT_MUTATION_MAX,
          timeWindow: "1 minute",
          keyGenerator: sessionRateLimitKey
        }
      }
    },
    async (request, reply) => {
      const access = await resolveOr401(dependencies, request, reply);
      if (!access) return reply;

      const body = request.body as { readonly snapshot?: unknown } | undefined;
      if (!dependencies.pageContextStore.update(access.actorUserId, body?.snapshot, "web")) {
        return reply.code(400).send({ error: "Invalid page context snapshot" });
      }
      return reply.code(204).send();
    }
  );

  server.get("/api/chat/stream", async (request, reply) => {
    const access = await resolveOr401(dependencies, request, reply);
    if (!access) return reply;

    // Subscriptions are keyed by the caller's actorUserId — a stream only ever
    // receives that actor's transcript records, never another user's.
    let unsubscribe: () => void;
    try {
      unsubscribe = runtime.manager.subscribe(access.actorUserId, (record) => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        reply.raw.write(`data: ${JSON.stringify(record)}\n\n`);
      });
    } catch (error) {
      return handleLiveRouteError(error, reply);
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    request.raw.on("close", () => {
      unsubscribe();
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    });

    // Keep the Fastify handler open until the client disconnects.
    return reply;
  });
}

export function buildEveningInterviewSeed(reviewText: string | null): EveningInterviewSeed {
  const external = sanitizeExternalData(reviewText?.trim() || "(no evening review was available)");
  return {
    context:
      "<trusted_instructions>\n" +
      "You are running Jarvis's evening interview. Ask concise reflection and planning " +
      "questions: what went well, what slipped, and what one thing matters tomorrow. Do " +
      "not create, move, or delete records directly; use normal chat action-request proposals.\n" +
      "</trusted_instructions>\n\n" +
      `<external_source type="evening_review">\n${external}\n</external_source>`,
    openingPrompt: "Prep me for tomorrow."
  };
}

function sanitizeExternalData(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function readEveningInterviewBody(body: unknown): { briefingRunId?: string } | { error: string } {
  if (body === undefined) return {};
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Expected JSON object body" };
  }
  const raw = (body as Record<string, unknown>).briefingRunId;
  if (raw === undefined) return {};
  if (typeof raw !== "string" || raw.trim() === "") {
    return { error: "briefingRunId must be a non-empty string" };
  }
  return { briefingRunId: raw.trim() };
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

  if (error instanceof ChatStreamLimitError) {
    return reply.code(429).send({ error: "Too many open chat streams." });
  }

  if (error instanceof ChatThreadNotFoundError) {
    return reply.code(404).send({ error: "Chat thread not found." });
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

  if (error instanceof CliChatUnavailableError) {
    // Log the underlying cause server-side; send a fixed, sanitized message (the
    // error covers both "no multiplexer configured" and "launch failed").
    reply.log?.warn?.(
      { err: error, cause: (error as { cause?: unknown }).cause },
      "live chat unavailable"
    );
    return reply.code(503).send({ error: "Live chat is currently unavailable on this host." });
  }

  // Unexpected error: do not leak the raw message/stack.
  reply.log?.error?.({ err: error }, "live chat route failed");
  return reply.code(500).send({ error: "Live chat is temporarily unavailable." });
}

/**
 * Parse a /turn body: `text` plus the optional #1133 `attachmentIds` list. Text may
 * be empty ONLY when at least one attachment id rides along (an image-only turn —
 * the engine still receives the server-composed attachments manifest). Ids are
 * shape-checked as UUIDs here so nothing unvalidated ever reaches a vault path.
 */
function readTurnBody(
  body: unknown
): { text: string; attachmentIds: readonly string[] } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { error: "text is required" };
  const record = body as Record<string, unknown>;

  let attachmentIds: string[] = [];
  const rawIds = record.attachmentIds;
  if (rawIds !== undefined) {
    if (!Array.isArray(rawIds)) return { error: "attachmentIds must be an array" };
    if (rawIds.length > MAX_ATTACHMENTS_PER_TURN) {
      return {
        error: `attachmentIds must have ${MAX_ATTACHMENTS_PER_TURN} entries or fewer`
      };
    }
    for (const id of rawIds) {
      if (typeof id !== "string" || !isAttachmentId(id)) {
        return { error: "attachmentIds must contain valid attachment ids" };
      }
    }
    // Dedupe so a repeated id can't double-render in the engine manifest.
    attachmentIds = [...new Set(rawIds as string[])];
  }

  const value = record.text;
  const hasAttachments = attachmentIds.length > 0;
  if (typeof value !== "string") {
    if (value === undefined && hasAttachments) return { text: "", attachmentIds };
    return { error: "text is required" };
  }
  if (value.length > MAX_CHAT_TURN_TEXT_LENGTH) {
    return { error: `text must be ${MAX_CHAT_TURN_TEXT_LENGTH} characters or fewer` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 && !hasAttachments) return { error: "text is required" };
  return { text: trimmed, attachmentIds };
}
