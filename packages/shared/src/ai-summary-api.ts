import { errorResponseSchema } from "./schema-fragments.js";

export interface AiSummaryDto {
  readonly hasPersonalAiProvider: boolean;
  readonly sharedAssistantAvailable: boolean;
}

export interface GetAiSummaryResponse {
  readonly summary: AiSummaryDto;
}

export const aiSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["hasPersonalAiProvider", "sharedAssistantAvailable"],
  properties: {
    hasPersonalAiProvider: { type: "boolean" },
    sharedAssistantAvailable: { type: "boolean" }
  }
} as const;

export const getAiSummaryResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: {
    summary: aiSummarySchema
  }
} as const;

export const getAiSummaryRouteSchema = {
  response: {
    200: getAiSummaryResponseSchema,
    401: errorResponseSchema
  }
} as const;
