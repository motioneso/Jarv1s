import type { AiCapabilityRouteReason, AiConfiguredModelDto, AiModelCapability } from "./ai-api.js";
import { errorResponseSchema } from "./schema-fragments.js";

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus = "stored" | "pending" | "blocked" | "no_model" | "working" | "error";

export interface ChatActivityEventDto {
  readonly kind: string;
  readonly text: string;
}

export interface ChatThreadDto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChatModelRouteMetadataDto {
  readonly capability: Extract<AiModelCapability, "chat">;
  readonly available: boolean;
  readonly reason: AiCapabilityRouteReason;
  readonly model: AiConfiguredModelDto | null;
}

export interface ChatSelectedToolMetadataDto {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly name: string;
  readonly permissionId: string;
  readonly risk: "read" | "write" | "destructive";
}

export interface ChatMessageDto {
  readonly id: string;
  readonly threadId: string;
  readonly ownerUserId: string;
  readonly role: ChatMessageRole;
  readonly status: ChatMessageStatus;
  readonly body: string;
  readonly modelRoute: ChatModelRouteMetadataDto | null;
  readonly tools: readonly ChatSelectedToolMetadataDto[];
  readonly activity: readonly ChatActivityEventDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListChatThreadsResponse {
  readonly threads: readonly ChatThreadDto[];
}

export interface ListChatThreadMessagesResponse {
  readonly messages: readonly ChatMessageDto[];
}

export type MemoryCorrectionReasonDto = "rejected" | "corrected";
export type MemoryCorrectionSourceDto = "chat" | "pattern-reject";

export interface MemoryCorrectionDto {
  readonly id: string;
  readonly category: string;
  readonly content: string;
  readonly reason: MemoryCorrectionReasonDto;
  readonly source: MemoryCorrectionSourceDto;
  readonly factId: string | null;
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
  readonly createdAt: string;
}

export interface ListMemoryCorrectionsResponse {
  readonly corrections: readonly MemoryCorrectionDto[];
}

export interface CreateChatThreadRequest {
  readonly title: string;
}

export interface AppendChatUserMessageRequest {
  readonly body: string;
  readonly selectedToolNames?: readonly string[];
}

const chatThreadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "ownerUserId", "title", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    title: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

const chatActivityEventSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "text"],
  properties: {
    kind: { type: "string" },
    text: { type: "string" }
  }
} as const;

const chatSelectedToolMetadataSchema = {
  type: "object",
  additionalProperties: false,
  required: ["moduleId", "moduleName", "name", "permissionId", "risk"],
  properties: {
    moduleId: { type: "string" },
    moduleName: { type: "string" },
    name: { type: "string" },
    permissionId: { type: "string" },
    risk: { type: "string", enum: ["read", "write", "destructive"] }
  }
} as const;

const chatModelRouteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["capability", "available", "reason", "model"],
  properties: {
    capability: { type: "string", enum: ["chat"] },
    available: { type: "boolean" },
    reason: { type: "string" },
    model: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] }
  }
} as const;

const chatMessageSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "threadId",
    "ownerUserId",
    "role",
    "status",
    "body",
    "modelRoute",
    "tools",
    "activity",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    threadId: { type: "string" },
    ownerUserId: { type: "string" },
    role: { type: "string", enum: ["user", "assistant"] },
    status: {
      type: "string",
      enum: ["stored", "pending", "blocked", "no_model", "working", "error"]
    },
    body: { type: "string" },
    modelRoute: { anyOf: [chatModelRouteSchema, { type: "null" }] },
    tools: { type: "array", items: chatSelectedToolMetadataSchema },
    activity: { type: "array", items: chatActivityEventSchema },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

export const listChatThreadsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["threads"],
  properties: {
    threads: { type: "array", items: chatThreadSchema }
  }
} as const;

export const listChatThreadsRouteSchema = {
  response: {
    200: listChatThreadsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const listChatThreadMessagesResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["messages"],
  properties: {
    messages: { type: "array", items: chatMessageSchema }
  }
} as const;

export const listChatThreadMessagesRouteSchema = {
  response: {
    200: listChatThreadMessagesResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const memoryCorrectionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "category",
    "content",
    "reason",
    "source",
    "factId",
    "beforeContent",
    "afterContent",
    "createdAt"
  ],
  properties: {
    id: { type: "string" },
    category: { type: "string" },
    content: { type: "string" },
    reason: { type: "string", enum: ["rejected", "corrected"] },
    source: { type: "string", enum: ["chat", "pattern-reject"] },
    factId: { anyOf: [{ type: "string" }, { type: "null" }] },
    beforeContent: { anyOf: [{ type: "string" }, { type: "null" }] },
    afterContent: { anyOf: [{ type: "string" }, { type: "null" }] },
    createdAt: { type: "string" }
  }
} as const;

export const listMemoryCorrectionsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["corrections"],
  properties: {
    corrections: { type: "array", items: memoryCorrectionSchema }
  }
} as const;

export const listMemoryCorrectionsRouteSchema = {
  response: {
    200: listMemoryCorrectionsResponseSchema,
    401: errorResponseSchema
  }
} as const;
