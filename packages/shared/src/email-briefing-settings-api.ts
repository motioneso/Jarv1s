import { errorResponseSchema } from "./schema-fragments.js";

export interface EmailBriefingSettingsDto {
  readonly createTasks: boolean;
  readonly suggestReplies: boolean;
  readonly draftReplies: boolean;
  readonly autoSend: boolean;
}

export interface GetEmailBriefingSettingsResponse {
  readonly settings: EmailBriefingSettingsDto;
}

export interface UpdateEmailBriefingSettingsRequest {
  readonly createTasks?: boolean;
  readonly suggestReplies?: boolean;
  readonly draftReplies?: boolean;
  readonly autoSend?: boolean;
}

export interface UpdateEmailBriefingSettingsResponse {
  readonly settings: EmailBriefingSettingsDto;
}

export const emailBriefingSettingsDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: ["createTasks", "suggestReplies", "draftReplies", "autoSend"],
  properties: {
    createTasks: { type: "boolean" },
    suggestReplies: { type: "boolean" },
    draftReplies: { type: "boolean" },
    autoSend: { type: "boolean" }
  }
} as const;

export const getEmailBriefingSettingsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["settings"],
  properties: {
    settings: emailBriefingSettingsDtoSchema
  }
} as const;

export const updateEmailBriefingSettingsRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    createTasks: { type: "boolean" },
    suggestReplies: { type: "boolean" },
    draftReplies: { type: "boolean" },
    autoSend: { type: "boolean" }
  }
} as const;

export const getEmailBriefingSettingsRouteSchema = {
  response: {
    200: getEmailBriefingSettingsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const updateEmailBriefingSettingsRouteSchema = {
  body: updateEmailBriefingSettingsRequestSchema,
  response: {
    200: getEmailBriefingSettingsResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;
