import { errorResponseSchema } from "./schema-fragments.js";

export type RuntimeConfigSource = "instance" | "env" | "default";

export interface RuntimeConfigStatusDto {
  readonly value: string | null;
  readonly source: RuntimeConfigSource;
}

export interface GetRuntimeConfigResponse {
  readonly config: RuntimeConfigStatusDto;
}

export interface PutRuntimeConfigRequest {
  readonly value: string;
}

export type PutRuntimeConfigResponse = GetRuntimeConfigResponse;

const runtimeConfigStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "source"],
  properties: {
    value: { type: ["string", "null"] },
    source: { type: "string", enum: ["instance", "env", "default"] }
  }
} as const;

const runtimeConfigEnvelopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["config"],
  properties: { config: runtimeConfigStatusSchema }
} as const;

export const getRuntimeConfigRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["key"],
    properties: { key: { type: "string", minLength: 1, maxLength: 120 } }
  },
  response: {
    200: runtimeConfigEnvelopeSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const putRuntimeConfigRouteSchema = {
  params: getRuntimeConfigRouteSchema.params,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: {
      value: { type: "string", maxLength: 1000 }
    }
  },
  response: {
    200: runtimeConfigEnvelopeSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;
