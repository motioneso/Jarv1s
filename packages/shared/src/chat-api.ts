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
