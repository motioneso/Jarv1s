import { errorResponseSchema } from "./schema-fragments.js";

export type SourceBehaviorDefault = "default-on" | "default-off" | "coming-soon";

export interface SourceBehaviorDto {
  readonly id: string;
  readonly sourceId: string;
  readonly name: string;
  readonly description: string;
  readonly default: SourceBehaviorDefault;
  readonly enabled: boolean;
  readonly toggleable: boolean;
}

export interface SourceBehaviorSourceDto {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly behaviors: readonly SourceBehaviorDto[];
}

export interface ListSourceBehaviorsResponse {
  readonly sources: readonly SourceBehaviorSourceDto[];
}

export interface PutSourceBehaviorRequest {
  readonly enabled: boolean;
}

export type PutSourceBehaviorResponse = ListSourceBehaviorsResponse;

const sourceBehaviorDefaultSchema = {
  type: "string",
  enum: ["default-on", "default-off", "coming-soon"]
} as const;

const sourceBehaviorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "sourceId", "name", "description", "default", "enabled", "toggleable"],
  properties: {
    id: { type: "string" },
    sourceId: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    default: sourceBehaviorDefaultSchema,
    enabled: { type: "boolean" },
    toggleable: { type: "boolean" }
  }
} as const;

const sourceBehaviorSourceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "description", "behaviors"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    behaviors: { type: "array", items: sourceBehaviorSchema }
  }
} as const;

export const listSourceBehaviorsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["sources"],
      properties: {
        sources: { type: "array", items: sourceBehaviorSourceSchema }
      }
    },
    401: errorResponseSchema
  }
} as const;

export const putSourceBehaviorRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string" } }
  },
  body: {
    type: "object",
    additionalProperties: false,
    required: ["enabled"],
    properties: { enabled: { type: "boolean" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["sources"],
      properties: {
        sources: { type: "array", items: sourceBehaviorSourceSchema }
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    422: errorResponseSchema
  }
} as const;
