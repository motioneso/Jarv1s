import { errorResponseSchema, jsonObjectSchema, nullableStringSchema } from "./schema-fragments.js";

export interface EmailMessageDto {
  readonly id: string;
  readonly connectorAccountId: string;
  readonly ownerUserId: string;
  readonly sender: string;
  readonly recipients: readonly string[];
  readonly subject: string;
  readonly snippet: string | null;
  readonly bodyExcerpt: string | null;
  readonly summary: string | null;
  readonly signals: Record<string, unknown>;
  readonly receivedAt: string;
  readonly externalId: string;
  readonly externalMetadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListEmailMessagesResponse {
  readonly messages: readonly EmailMessageDto[];
}

export interface GetEmailMessageResponse {
  readonly message: EmailMessageDto;
}

const emailMessageParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string" }
  }
} as const;

export const emailMessageDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "connectorAccountId",
    "ownerUserId",
    "sender",
    "recipients",
    "subject",
    "snippet",
    "bodyExcerpt",
    "summary",
    "signals",
    "receivedAt",
    "externalId",
    "externalMetadata",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    connectorAccountId: { type: "string" },
    ownerUserId: { type: "string" },
    sender: { type: "string" },
    recipients: { type: "array", items: { type: "string" } },
    subject: { type: "string" },
    snippet: nullableStringSchema,
    bodyExcerpt: nullableStringSchema,
    summary: nullableStringSchema,
    signals: jsonObjectSchema,
    receivedAt: { type: "string" },
    externalId: { type: "string" },
    externalMetadata: jsonObjectSchema,
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

export const listEmailMessagesResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["messages"],
  properties: {
    messages: {
      type: "array",
      items: emailMessageDtoSchema
    }
  }
} as const;

export const getEmailMessageResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: emailMessageDtoSchema
  }
} as const;

export const listEmailMessagesRouteSchema = {
  response: {
    200: listEmailMessagesResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const getEmailMessageRouteSchema = {
  params: emailMessageParamsSchema,
  response: {
    200: getEmailMessageResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;
