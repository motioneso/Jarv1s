import { errorResponseSchema } from "./schema-fragments.js";

// #874 — the dedicated Voice (STT) endpoint API schemas. Split out of ai-api.ts to keep that file
// under the 1000-line source cap; they form one cohesive unit (the single instance-wide voice
// endpoint has nothing to do with the generic provider/model schemas next door).

// The single Voice (STT) endpoint DTO. The API key is WRITE-ONLY: it appears in the PUT request but
// NEVER in this response shape (no plaintext, no ciphertext) — only `hasKey` reports whether one is
// stored. `additionalProperties: false` keeps the key from ever being tacked on.
export const aiVoiceEndpointSchema = {
  type: "object",
  additionalProperties: false,
  required: ["configured", "enabled", "baseUrl", "modelName", "hasKey"],
  properties: {
    configured: { type: "boolean" },
    enabled: { type: "boolean" },
    baseUrl: { type: ["string", "null"] },
    modelName: { type: ["string", "null"] },
    hasKey: { type: "boolean" }
  }
} as const;

export const getVoiceEndpointResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["endpoint"],
  properties: {
    endpoint: aiVoiceEndpointSchema
  }
} as const;

// PUT body. `apiKey` is optional (omit-means-keep on edit); when present it must be a non-empty
// string. `baseUrl`/`modelName` are required and non-empty (a voice endpoint is meaningless without
// them). `enabled` toggles the backing provider status.
export const putVoiceEndpointRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["baseUrl", "modelName"],
  properties: {
    baseUrl: { type: "string", minLength: 1 },
    modelName: { type: "string", minLength: 1 },
    apiKey: { type: "string", minLength: 1 },
    enabled: { type: "boolean" }
  }
} as const;

export const putVoiceEndpointResponseSchema = getVoiceEndpointResponseSchema;

// Voice (STT) endpoint routes. Both are admin-gated in the handler (assertInstanceAdmin); the 403
// branch is the non-admin rejection. GET returns the endpoint DTO (never the key); PUT is an
// admin-only upsert.
export const getVoiceEndpointRouteSchema = {
  response: {
    200: getVoiceEndpointResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const putVoiceEndpointRouteSchema = {
  body: putVoiceEndpointRequestSchema,
  response: {
    200: putVoiceEndpointResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;
