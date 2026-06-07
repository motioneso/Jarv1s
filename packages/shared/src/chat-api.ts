import type { AiCapabilityRouteReason, AiConfiguredModelDto, AiModelCapability } from "./ai-api.js";

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus = "stored" | "pending" | "blocked" | "no_model";

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
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListChatThreadsResponse {
  readonly threads: readonly ChatThreadDto[];
}

export interface CreateChatThreadRequest {
  readonly title: string;
}

export interface CreateChatThreadResponse {
  readonly thread: ChatThreadDto;
}

export interface GetChatThreadResponse {
  readonly thread: ChatThreadDto;
}

export interface ListChatMessagesResponse {
  readonly messages: readonly ChatMessageDto[];
}

export interface AppendChatUserMessageRequest {
  readonly body: string;
  readonly selectedToolNames?: readonly string[];
}

export interface AppendChatUserMessageResponse {
  readonly thread: ChatThreadDto;
  readonly messages: readonly [ChatMessageDto, ChatMessageDto];
}

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: { type: "string" }
  }
} as const;

const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string" }
  }
} as const;

export const chatMessageRoleSchema = {
  type: "string",
  enum: ["user", "assistant"]
} as const;

export const chatMessageStatusSchema = {
  type: "string",
  enum: ["stored", "pending", "blocked", "no_model"]
} as const;

const aiConfiguredModelSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "providerConfigId",
    "providerKind",
    "providerDisplayName",
    "providerStatus",
    "providerModelId",
    "displayName",
    "capabilities",
    "status",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    providerConfigId: { type: "string" },
    providerKind: {
      type: "string",
      enum: ["openai-compatible", "anthropic", "google", "ollama", "custom"]
    },
    providerDisplayName: { type: "string" },
    providerStatus: { type: "string", enum: ["active", "error", "disabled", "revoked"] },
    providerModelId: { type: "string" },
    displayName: { type: "string" },
    capabilities: {
      type: "array",
      items: { type: "string", enum: ["chat", "tool-use", "json", "vision", "summarization"] }
    },
    status: { type: "string", enum: ["active", "disabled"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

const chatModelRouteMetadataSchema = {
  type: "object",
  additionalProperties: false,
  required: ["capability", "available", "reason", "model"],
  properties: {
    capability: { type: "string", enum: ["chat"] },
    available: { type: "boolean" },
    reason: { type: "string", enum: ["matched-active-model", "no-active-model"] },
    model: {
      anyOf: [aiConfiguredModelSchema, { type: "null" }]
    }
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
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    threadId: { type: "string" },
    ownerUserId: { type: "string" },
    role: chatMessageRoleSchema,
    status: chatMessageStatusSchema,
    body: { type: "string" },
    modelRoute: {
      anyOf: [chatModelRouteMetadataSchema, { type: "null" }]
    },
    tools: { type: "array", items: chatSelectedToolMetadataSchema },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

export const createChatThreadRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    title: { type: "string" }
  }
} as const;

export const appendChatUserMessageRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["body"],
  properties: {
    body: { type: "string" },
    selectedToolNames: {
      type: "array",
      items: { type: "string" }
    }
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

export const createChatThreadResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["thread"],
  properties: {
    thread: chatThreadSchema
  }
} as const;

export const getChatThreadResponseSchema = createChatThreadResponseSchema;

export const listChatMessagesResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["messages"],
  properties: {
    messages: { type: "array", items: chatMessageSchema }
  }
} as const;

export const appendChatUserMessageResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["thread", "messages"],
  properties: {
    thread: chatThreadSchema,
    messages: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: chatMessageSchema
    }
  }
} as const;

export const listChatThreadsRouteSchema = {
  response: {
    200: listChatThreadsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const createChatThreadRouteSchema = {
  body: createChatThreadRequestSchema,
  response: {
    201: createChatThreadResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const getChatThreadRouteSchema = {
  params: idParamsSchema,
  response: {
    200: getChatThreadResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const listChatMessagesRouteSchema = {
  params: idParamsSchema,
  response: {
    200: listChatMessagesResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const appendChatUserMessageRouteSchema = {
  params: idParamsSchema,
  body: appendChatUserMessageRequestSchema,
  response: {
    201: appendChatUserMessageResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;
