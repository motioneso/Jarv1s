import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";

import type { AccessContext, ChatMessage, ChatThread, DataContextRunner } from "@jarv1s/db";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  appendChatUserMessageRouteSchema,
  createChatThreadRouteSchema,
  getChatThreadRouteSchema,
  listChatMessagesRouteSchema,
  listChatThreadsRouteSchema,
  type AppendChatUserMessageRequest,
  type ChatActivityEventDto,
  type ChatMessageDto,
  type ChatModelRouteMetadataDto,
  type ChatSelectedToolMetadataDto,
  type ChatThreadDto,
  type CreateChatThreadRequest
} from "@jarv1s/shared";

import { ChatRepository, type ChatExecutionJobPayload } from "./repository.js";

export interface ChatRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly listModuleManifests: () => readonly JarvisModuleManifest[];
  readonly boss: PgBoss;
  readonly repository?: ChatRepository;
}

interface ChatThreadParams {
  readonly id: string;
}

export function registerChatRoutes(
  server: FastifyInstance,
  dependencies: ChatRoutesDependencies
): void {
  const enqueue = (queueName: string, payload: ChatExecutionJobPayload) =>
    dependencies.boss.send(queueName, payload);
  const repository = dependencies.repository ?? new ChatRepository(undefined, enqueue);

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

  server.post(
    "/api/chat/threads",
    { schema: createChatThreadRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = parseCreateThreadBody(request.body);
        const thread = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.createThread(scopedDb, input)
        );

        return reply.code(201).send({ thread: serializeThread(thread) });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: ChatThreadParams }>(
    "/api/chat/threads/:id",
    { schema: getChatThreadRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const thread = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.getThreadById(scopedDb, request.params.id)
        );

        if (!thread) {
          return reply.code(404).send({ error: "Chat thread not found" });
        }

        return { thread: serializeThread(thread) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: ChatThreadParams }>(
    "/api/chat/threads/:id/messages",
    { schema: listChatMessagesRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const result = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const thread = await repository.getThreadById(scopedDb, request.params.id);

            return thread
              ? {
                  thread,
                  messages: await repository.listMessages(scopedDb, thread.id)
                }
              : undefined;
          }
        );

        if (!result) {
          return reply.code(404).send({ error: "Chat thread not found" });
        }

        return { messages: result.messages.map(serializeMessage) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: ChatThreadParams }>(
    "/api/chat/threads/:id/messages",
    { schema: appendChatUserMessageRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseAppendMessageBody(request.body);
        const selectedTools = selectAssistantTools(
          dependencies.listModuleManifests(),
          body.selectedToolNames ?? []
        );
        const result = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.appendUserMessage(
            scopedDb,
            request.params.id,
            { body: body.body, selectedTools },
            accessContext.actorUserId
          )
        );

        if (!result) {
          return reply.code(404).send({ error: "Chat thread not found" });
        }

        return reply.code(201).send({
          thread: serializeThread(result.thread),
          messages: result.messages.map(serializeMessage)
        });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

function parseCreateThreadBody(body: unknown): CreateChatThreadRequest {
  const value = requireObject(body);

  return {
    title: requiredString(value.title, "title")
  };
}

function parseAppendMessageBody(body: unknown): AppendChatUserMessageRequest {
  const value = requireObject(body);

  return {
    body: requiredString(value.body, "body"),
    selectedToolNames: optionalStringArray(value.selectedToolNames, "selectedToolNames")
  };
}

function selectAssistantTools(
  moduleManifests: readonly JarvisModuleManifest[],
  selectedToolNames: readonly string[]
): ChatSelectedToolMetadataDto[] {
  const toolsByName = new Map(
    moduleManifests.flatMap((module) =>
      (module.assistantTools ?? []).map((tool) => [
        tool.name,
        {
          moduleId: module.id,
          moduleName: module.name,
          name: tool.name,
          permissionId: tool.permissionId,
          risk: tool.risk
        }
      ])
    )
  );
  const uniqueNames = [...new Set(selectedToolNames)];

  return uniqueNames.map((name) => {
    const tool = toolsByName.get(name);

    if (!tool) {
      throw new HttpError(400, `Assistant tool is not declared: ${name}`);
    }

    return tool;
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

function serializeMessage(message: ChatMessage): ChatMessageDto {
  return {
    id: message.id,
    threadId: message.thread_id,
    ownerUserId: message.owner_user_id,
    role: message.role,
    status: message.status,
    body: message.body,
    modelRoute: readModelRoute(message.model_metadata),
    tools: readSelectedTools(message.tool_metadata),
    activity: readActivity(message.model_metadata),
    createdAt: toIsoString(message.created_at),
    updatedAt: toIsoString(message.updated_at)
  };
}

function readModelRoute(metadata: Record<string, unknown>): ChatModelRouteMetadataDto | null {
  const route = metadata.route;

  return route && typeof route === "object" ? (route as ChatModelRouteMetadataDto) : null;
}

function readSelectedTools(metadata: Record<string, unknown>): ChatSelectedToolMetadataDto[] {
  const tools = metadata.selectedTools;

  return Array.isArray(tools) ? (tools as ChatSelectedToolMetadataDto[]) : [];
}

function readActivity(metadata: Record<string, unknown>): ChatActivityEventDto[] {
  const activity = metadata.activity;

  return Array.isArray(activity) ? (activity as ChatActivityEventDto[]) : [];
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected JSON object body");
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, fieldName: string): string {
  const parsed = optionalString(value, fieldName);

  if (!parsed) {
    throw new HttpError(400, `${fieldName} is required`);
  }

  return parsed;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new HttpError(400, `${fieldName} must not be empty`);
  }

  return trimmed;
}

function optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} must be an array`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new HttpError(400, `${fieldName}[${index}] must be a non-empty string`);
    }

    return item.trim();
  });
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

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
