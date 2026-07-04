import { errorResponseSchema, jsonObjectSchema, nullableStringSchema } from "./schema-fragments.js";

export interface EmailMessageDto {
  readonly id: string;
  readonly ownerUserId: string;
  /**
   * Email-derived strings are untrusted provider content. Render only as text nodes or escaped
   * attributes; never pass these fields to raw HTML, Markdown, or linkification without a sanitizer.
   */
  readonly sender: string;
  readonly recipients: readonly string[];
  readonly subject: string;
  readonly snippet: string | null;
  readonly bodyExcerpt: string | null;
  readonly summary: string | null;
  readonly signals: Record<string, unknown>;
  readonly receivedAt: string;
  readonly externalId: string;
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
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
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

// Email-derived task creation modes (#729 §5). `suggest` is the default: staged
// `suggested` tasks the user reviews; auto modes promote a narrow slice to real todos.
export const EMAIL_TASK_CREATION_MODES = ["off", "suggest", "auto_safe", "auto"] as const;

export type EmailTaskCreationMode = (typeof EMAIL_TASK_CREATION_MODES)[number];

export const DEFAULT_EMAIL_TASK_MODE: EmailTaskCreationMode = "suggest";

export const EMAIL_TASK_MODE_PREF_KEY = "email.task_creation_mode";

export function parseEmailTaskMode(value: unknown): EmailTaskCreationMode {
  return typeof value === "string" &&
    (EMAIL_TASK_CREATION_MODES as readonly string[]).includes(value)
    ? (value as EmailTaskCreationMode)
    : DEFAULT_EMAIL_TASK_MODE;
}

export interface EmailTaskCreationModeResponse {
  readonly mode: EmailTaskCreationMode;
}

export interface UpdateEmailTaskCreationModeRequest {
  readonly mode: EmailTaskCreationMode;
}

export const emailTaskCreationModeResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode"],
  properties: {
    mode: { type: "string", enum: [...EMAIL_TASK_CREATION_MODES] }
  }
} as const;

export const updateEmailTaskCreationModeRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode"],
  properties: {
    mode: { type: "string", enum: [...EMAIL_TASK_CREATION_MODES] }
  }
} as const;

export const getEmailTaskCreationModeRouteSchema = {
  response: {
    200: emailTaskCreationModeResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const updateEmailTaskCreationModeRouteSchema = {
  body: updateEmailTaskCreationModeRequestSchema,
  response: {
    200: emailTaskCreationModeResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema
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
