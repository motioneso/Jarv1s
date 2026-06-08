import type { AiCapabilityRouteReason, AiConfiguredModelDto, AiModelCapability } from "./ai-api.js";

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

export interface CreateChatThreadRequest {
  readonly title: string;
}

export interface AppendChatUserMessageRequest {
  readonly body: string;
  readonly selectedToolNames?: readonly string[];
}

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: { type: "string" }
  }
} as const;

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
