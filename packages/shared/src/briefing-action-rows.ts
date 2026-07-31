export type BriefingActionCategory = "needs_reply" | "needs_action" | "time_sensitive_info";

export type BriefingActionPrimaryAction =
  | { readonly kind: "reply"; readonly cacheMessageId: string }
  | { readonly kind: "view"; readonly href: string };

export type BriefingActionResurfaceReason = "due_tomorrow" | "relevant_context";

export interface TaskSuggestionMetadataV1 {
  readonly version: 1;
  readonly category: BriefingActionCategory;
  readonly sourceLabel: string;
  readonly sourceHref: string;
  readonly cacheMessageId: string | null;
  readonly subjectSignature: string;
  readonly computedAt: string;
  readonly resurfaceReason: BriefingActionResurfaceReason | null;
}

export interface BriefingActionRowDto {
  readonly taskId: string;
  readonly title: string;
  readonly explanation: string;
  readonly category: BriefingActionCategory;
  readonly status: "suggested" | "accepted" | "dismissed";
  readonly primaryAction: BriefingActionPrimaryAction;
  readonly source: string;
  readonly sourceLabel: string;
  readonly sourceRef: string;
  readonly sourceHref: string;
  readonly dueAt: string | null;
  readonly computedAt: string;
  readonly resurfaceReason: BriefingActionResurfaceReason | null;
}

export interface BriefingCatchUpDto {
  readonly source: "email";
  readonly itemCount: number;
  readonly summaryText: string;
  readonly asOf: string | null;
}

export interface BriefingStructuredPayloadV1 {
  readonly version: 1;
  readonly actionRows: readonly BriefingActionRowDto[];
  readonly catchUp: BriefingCatchUpDto | null;
}

const actionCategorySchema = {
  type: "string",
  enum: ["needs_reply", "needs_action", "time_sensitive_info"]
} as const;

const resurfaceReasonSchema = {
  type: ["string", "null"],
  enum: ["due_tomorrow", "relevant_context", null]
} as const;

const primaryActionSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "cacheMessageId"],
      properties: { kind: { type: "string", enum: ["reply"] }, cacheMessageId: { type: "string" } }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "href"],
      properties: { kind: { type: "string", enum: ["view"] }, href: { type: "string" } }
    }
  ]
} as const;

export const taskSuggestionMetadataV1Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "category",
    "sourceLabel",
    "sourceHref",
    "cacheMessageId",
    "subjectSignature",
    "computedAt",
    "resurfaceReason"
  ],
  properties: {
    version: { type: "integer", enum: [1] },
    category: actionCategorySchema,
    sourceLabel: { type: "string" },
    sourceHref: { type: "string" },
    cacheMessageId: { type: ["string", "null"] },
    subjectSignature: { type: "string" },
    computedAt: { type: "string" },
    resurfaceReason: resurfaceReasonSchema
  }
} as const;

export const briefingActionRowDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "taskId",
    "title",
    "explanation",
    "category",
    "status",
    "primaryAction",
    "source",
    "sourceLabel",
    "sourceRef",
    "sourceHref",
    "dueAt",
    "computedAt",
    "resurfaceReason"
  ],
  properties: {
    taskId: { type: "string" },
    title: { type: "string" },
    explanation: { type: "string" },
    category: actionCategorySchema,
    status: { type: "string", enum: ["suggested", "accepted", "dismissed"] },
    primaryAction: primaryActionSchema,
    source: { type: "string" },
    sourceLabel: { type: "string" },
    sourceRef: { type: "string" },
    sourceHref: { type: "string" },
    dueAt: { type: ["string", "null"] },
    computedAt: { type: "string" },
    resurfaceReason: resurfaceReasonSchema
  }
} as const;

export const briefingCatchUpDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "itemCount", "summaryText", "asOf"],
  properties: {
    source: { type: "string", enum: ["email"] },
    itemCount: { type: "integer", minimum: 0 },
    summaryText: { type: "string" },
    asOf: { type: ["string", "null"] }
  }
} as const;

export const briefingStructuredPayloadV1Schema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "actionRows", "catchUp"],
  properties: {
    version: { type: "integer", enum: [1] },
    actionRows: { type: "array", items: briefingActionRowDtoSchema },
    catchUp: { anyOf: [briefingCatchUpDtoSchema, { type: "null" }] }
  }
} as const;
