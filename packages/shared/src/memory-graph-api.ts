const memorySourceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sourceKind", "sourceRef", "excerpt"],
  properties: {
    sourceKind: {
      type: "string",
      enum: ["chat", "note", "task", "email", "calendar", "manual"]
    },
    sourceRef: { type: "string" },
    sourceLabel: { type: "string" },
    occurredAt: { type: ["string", "null"] },
    excerpt: { type: "string" }
  }
} as const;

const memoryRecallItemSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "id",
    "title",
    "text",
    "score",
    "confidence",
    "provenance",
    "validFrom",
    "validTo",
    "sources"
  ],
  properties: {
    kind: { type: "string", enum: ["entity", "fact", "episode"] },
    id: { type: "string" },
    title: { type: "string" },
    text: { type: "string" },
    score: { type: "number" },
    confidence: { type: "number" },
    provenance: { type: "string", enum: ["volunteered", "inferred", "confirmed", "imported"] },
    validFrom: { type: ["string", "null"] },
    validTo: { type: ["string", "null"] },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "sourceKind", "sourceRef", "sourceLabel", "excerpt", "occurredAt"],
        properties: {
          id: { type: "string" },
          sourceKind: { type: "string" },
          sourceRef: { type: "string" },
          sourceLabel: { type: "string" },
          excerpt: { type: "string" },
          occurredAt: { type: ["string", "null"] }
        }
      }
    }
  }
} as const;

const memoryGraphErrorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: { type: "string" }
  }
} as const;

export const memoryGraphRecallResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["query", "items"],
  properties: {
    query: { type: "string" },
    items: { type: "array", items: memoryRecallItemSchema }
  }
} as const;

export const getMemoryGraphRecallRouteSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["q"],
    properties: {
      q: { type: "string" },
      limit: { type: "number" },
      includeInactive: { type: "boolean" }
    }
  },
  response: {
    200: memoryGraphRecallResponseSchema,
    400: memoryGraphErrorResponseSchema
  }
} as const;

export const getMemoryGraphCoreRouteSchema = {
  response: {
    200: memoryGraphRecallResponseSchema
  }
} as const;

export const postMemoryGraphEntityRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "name"],
    properties: {
      kind: {
        type: "string",
        enum: [
          "person",
          "project",
          "preference",
          "goal",
          "constraint",
          "decision",
          "topic",
          "place",
          "organization",
          "self"
        ]
      },
      name: { type: "string" },
      summary: { type: "string" },
      importance: { type: "number" },
      pinned: { type: "boolean" }
    }
  }
} as const;

export const postMemoryGraphFactRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["predicate", "source"],
    properties: {
      subjectEntityId: { type: "string" },
      predicate: {
        type: "string",
        enum: [
          "prefers",
          "works_on",
          "has_goal",
          "has_constraint",
          "decided",
          "related_to",
          "owes",
          "waiting_on",
          "mentioned_in",
          "alias_of"
        ]
      },
      objectEntityId: { type: ["string", "null"] },
      objectText: { type: ["string", "null"] },
      confidence: { type: "number" },
      provenance: { type: "string", enum: ["volunteered", "inferred", "confirmed", "imported"] },
      importance: { type: "number" },
      pinned: { type: "boolean" },
      source: memorySourceSchema
    }
  }
} as const;

export const postMemoryGraphPinRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["pinned"],
    properties: {
      pinned: { type: "boolean" }
    }
  }
} as const;

export const postMemoryGraphSupersedeRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    properties: {
      validTo: { type: ["string", "null"] }
    }
  }
} as const;
