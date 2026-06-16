import { errorResponseSchema } from "./schema-fragments.js";

export interface PersonaSettingsDto {
  readonly assistantName: string;
  readonly personaText: string;
}

export interface GetPersonaSettingsResponse {
  readonly persona: PersonaSettingsDto;
}

export interface PutPersonaSettingsRequest {
  readonly persona: PersonaSettingsDto;
}

export type PutPersonaSettingsResponse = GetPersonaSettingsResponse;

export interface PreviewPersonaRequest {
  readonly persona: PersonaSettingsDto;
}

export interface PreviewPersonaResponse {
  readonly reply: string;
}

export const MAX_PERSONA_TEXT_LENGTH = 4_000;
export const MAX_PERSONA_NAME_LENGTH = 80;

export function sanitizePersonaName(rawName: string): string {
  const cleaned = rawName
    .replace(/\p{Cc}+/gu, " ")
    .replace(/[<>#`*_~[\]{}|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PERSONA_NAME_LENGTH)
    .trim();

  return cleaned.length > 0 ? cleaned : "there";
}

export function normalizePersonaSettings(value: unknown): PersonaSettingsDto {
  if (!value || typeof value !== "object") {
    return { assistantName: "Jarvis", personaText: "" };
  }
  const record = value as Record<string, unknown>;
  const assistantName =
    typeof record.assistantName === "string" ? sanitizePersonaName(record.assistantName) : "Jarvis";
  const personaText =
    typeof record.personaText === "string"
      ? record.personaText.slice(0, MAX_PERSONA_TEXT_LENGTH)
      : "";
  return { assistantName, personaText };
}

export function renderPersonaText(input: {
  readonly assistantName: string;
  readonly personaText: string;
  readonly userName: string;
}): string {
  const assistantName = sanitizePersonaName(input.assistantName);
  const userName = sanitizePersonaName(input.userName);
  const personaText = input.personaText
    .slice(0, MAX_PERSONA_TEXT_LENGTH)
    .replaceAll("{{userName}}", userName)
    .trim();

  return [`Your name is ${assistantName}.`, personaText].filter(Boolean).join("\n\n");
}

export const personaSettingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assistantName", "personaText"],
  properties: {
    assistantName: { type: "string", maxLength: MAX_PERSONA_NAME_LENGTH },
    personaText: { type: "string" }
  }
} as const;

export const getPersonaSettingsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["persona"],
      properties: {
        persona: personaSettingsSchema
      }
    },
    401: errorResponseSchema
  }
} as const;

export const putPersonaSettingsRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["persona"],
    properties: {
      persona: personaSettingsSchema
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["persona"],
      properties: {
        persona: personaSettingsSchema
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const previewPersonaRouteSchema = {
  body: putPersonaSettingsRouteSchema.body,
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["reply"],
      properties: {
        reply: { type: "string" }
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    503: errorResponseSchema
  }
} as const;
