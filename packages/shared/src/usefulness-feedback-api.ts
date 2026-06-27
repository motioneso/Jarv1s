import { errorResponseSchema, idParamsSchema, jsonObjectSchema } from "./schema-fragments.js";

export type UsefulnessFeedbackKind =
  | "more_like_this"
  | "too_much"
  | "wrong_priority"
  | "not_useful"
  | "remember_this"
  | "dismiss";

export type FeedbackTargetKind =
  | "chat_message"
  | "briefing_run"
  | "briefing_item"
  | "proactive_card";

export type FeedbackSurface = "chat" | "briefing" | "today" | "proactive";
export type FeedbackStatus = "active" | "undone";

export interface CreateUsefulnessFeedbackRequest {
  readonly targetKind: FeedbackTargetKind;
  readonly targetRef: string;
  readonly surface: FeedbackSurface;
  readonly kind: UsefulnessFeedbackKind;
}

export interface UsefulnessFeedbackDto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly targetKind: FeedbackTargetKind;
  readonly targetRef: string;
  readonly surface: FeedbackSurface;
  readonly kind: UsefulnessFeedbackKind;
  readonly sourceKind: string | null;
  readonly sourceLabel: string | null;
  readonly priorityBand: string | null;
  readonly effectKind: string | null;
  readonly effectRef: string | null;
  readonly metadata: Record<string, unknown>;
  readonly status: FeedbackStatus;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface CreateUsefulnessFeedbackResponse {
  readonly feedback: UsefulnessFeedbackDto;
}

export interface ListUsefulnessFeedbackResponse {
  readonly feedback: readonly UsefulnessFeedbackDto[];
}

export const usefulnessFeedbackKindSchema = {
  type: "string",
  enum: [
    "more_like_this",
    "too_much",
    "wrong_priority",
    "not_useful",
    "remember_this",
    "dismiss"
  ]
} as const;

export const feedbackTargetKindSchema = {
  type: "string",
  enum: ["chat_message", "briefing_run", "briefing_item", "proactive_card"]
} as const;

export const feedbackSurfaceSchema = {
  type: "string",
  enum: ["chat", "briefing", "today", "proactive"]
} as const;

export const createUsefulnessFeedbackRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["targetKind", "targetRef", "surface", "kind"],
  properties: {
    targetKind: feedbackTargetKindSchema,
    targetRef: { type: "string", minLength: 1, maxLength: 1024 },
    surface: feedbackSurfaceSchema,
    kind: usefulnessFeedbackKindSchema
  }
} as const;

export const usefulnessFeedbackSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "ownerUserId",
    "targetKind",
    "targetRef",
    "surface",
    "kind",
    "sourceKind",
    "sourceLabel",
    "priorityBand",
    "effectKind",
    "effectRef",
    "metadata",
    "status",
    "createdAt",
    "resolvedAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    targetKind: feedbackTargetKindSchema,
    targetRef: { type: "string" },
    surface: feedbackSurfaceSchema,
    kind: usefulnessFeedbackKindSchema,
    sourceKind: { type: ["string", "null"] },
    sourceLabel: { type: ["string", "null"] },
    priorityBand: { type: ["string", "null"] },
    effectKind: { type: ["string", "null"] },
    effectRef: { type: ["string", "null"] },
    metadata: jsonObjectSchema,
    status: { type: "string", enum: ["active", "undone"] },
    createdAt: { type: "string" },
    resolvedAt: { type: ["string", "null"] }
  }
} as const;

export const createUsefulnessFeedbackResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["feedback"],
  properties: { feedback: usefulnessFeedbackSchema }
} as const;

export const listUsefulnessFeedbackResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["feedback"],
  properties: { feedback: { type: "array", items: usefulnessFeedbackSchema } }
} as const;

export const createUsefulnessFeedbackRouteSchema = {
  body: createUsefulnessFeedbackRequestSchema,
  response: {
    200: createUsefulnessFeedbackResponseSchema,
    201: createUsefulnessFeedbackResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const listUsefulnessFeedbackRouteSchema = {
  response: {
    200: listUsefulnessFeedbackResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const undoUsefulnessFeedbackRouteSchema = {
  params: idParamsSchema,
  response: {
    200: createUsefulnessFeedbackResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;
