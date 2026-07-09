import { errorResponseSchema } from "./schema-fragments.js";

export const CHAT_SKILL_SOURCES = ["authored", "uploaded"] as const;
export type ChatSkillSourceDto = (typeof CHAT_SKILL_SOURCES)[number];

export interface ChatSkillDto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly description: string | null;
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
  readonly enabled: boolean;
  readonly source: ChatSkillSourceDto;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListChatSkillsResponse {
  readonly skills: readonly ChatSkillDto[];
}

export interface ChatSkillResponse {
  readonly skill: ChatSkillDto;
}

export interface CreateChatSkillRequest {
  readonly name: string;
  readonly description?: string | null;
  readonly frontmatter?: Record<string, unknown>;
  readonly body: string;
}

export interface UpdateChatSkillRequest {
  readonly name?: string;
  readonly description?: string | null;
  readonly frontmatter?: Record<string, unknown>;
  readonly body?: string;
}

export interface SetChatSkillEnabledRequest {
  readonly enabled: boolean;
}

const chatSkillSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "ownerUserId",
    "name",
    "description",
    "frontmatter",
    "body",
    "enabled",
    "source",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    name: { type: "string" },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    frontmatter: { type: "object", additionalProperties: true },
    body: { type: "string" },
    enabled: { type: "boolean" },
    source: { type: "string", enum: CHAT_SKILL_SOURCES },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

const listChatSkillsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["skills"],
  properties: {
    skills: { type: "array", items: chatSkillSchema }
  }
} as const;

const chatSkillResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["skill"],
  properties: {
    skill: chatSkillSchema
  }
} as const;

const createChatSkillRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "body"],
  properties: {
    name: { type: "string" },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    frontmatter: { type: "object" },
    body: { type: "string" }
  }
} as const;

const updateChatSkillRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    frontmatter: { type: "object" },
    body: { type: "string" }
  }
} as const;

const setChatSkillEnabledRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["enabled"],
  properties: {
    enabled: { type: "boolean" }
  }
} as const;

export const listChatSkillsRouteSchema = {
  response: {
    200: listChatSkillsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const getChatSkillRouteSchema = {
  response: {
    200: chatSkillResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const createChatSkillRouteSchema = {
  body: createChatSkillRequestSchema,
  response: {
    200: chatSkillResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const updateChatSkillRouteSchema = {
  body: updateChatSkillRequestSchema,
  response: {
    200: chatSkillResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const setChatSkillEnabledRouteSchema = {
  body: setChatSkillEnabledRequestSchema,
  response: {
    200: chatSkillResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const deleteChatSkillRouteSchema = {
  response: {
    204: { type: "null" },
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;
