export type AiProviderKind = "openai-compatible" | "anthropic" | "google" | "ollama" | "custom";
export type AiProviderStatus = "active" | "error" | "disabled" | "revoked";
export type AiAuthMethod = "cli" | "api_key";
export type AiModelStatus = "active" | "disabled";
export type AiModelCapability = "chat" | "tool-use" | "json" | "vision" | "summarization";
export type AiCapabilityRouteReason = "matched-active-model" | "no-active-model";

export interface AiProviderConfigDto {
  readonly id: string;
  readonly providerKind: AiProviderKind;
  readonly displayName: string;
  readonly baseUrl: string | null;
  readonly status: AiProviderStatus;
  readonly authMethod: AiAuthMethod;
  readonly hasCredential: boolean;
  readonly cliAvailable: boolean;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AiConfiguredModelDto {
  readonly id: string;
  readonly providerConfigId: string;
  readonly providerKind: AiProviderKind;
  readonly providerDisplayName: string;
  readonly providerStatus: AiProviderStatus;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly capabilities: readonly AiModelCapability[];
  readonly status: AiModelStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AiCapabilityRouteDto {
  readonly capability: AiModelCapability;
  readonly available: boolean;
  readonly reason: AiCapabilityRouteReason;
  readonly model: AiConfiguredModelDto | null;
}

export interface AiAssistantToolDto {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly name: string;
  readonly description: string;
  readonly permissionId: string;
  readonly risk: "read" | "write" | "destructive";
  readonly inputSchema: Record<string, unknown> | null;
  readonly outputSchema: Record<string, unknown> | null;
}

export type AiAssistantToolInvocationStatus = "succeeded" | "blocked";
export type AiAssistantToolBlockedReason =
  | "confirmation_required"
  | "non_read_risk"
  | "unsupported_tool";
export type AiAssistantActionRisk = "write" | "destructive";
export type AiAssistantActionStatus = "pending" | "confirmed" | "rejected" | "cancelled";
export type ResolveAiAssistantActionStatus = Exclude<AiAssistantActionStatus, "pending">;

export interface InvokeAiAssistantToolRequest {
  readonly input?: Record<string, unknown>;
}

export interface AiAssistantToolInvocationDto {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly name: string;
  readonly description: string;
  readonly permissionId: string;
  readonly risk: "read" | "write" | "destructive";
  readonly status: AiAssistantToolInvocationStatus;
  readonly blockedReason: AiAssistantToolBlockedReason | null;
  readonly actionRequestId: string | null;
  readonly result: Record<string, unknown> | null;
}

export interface AiAssistantActionDto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly toolModuleId: string;
  readonly toolModuleName: string;
  readonly toolName: string;
  readonly permissionId: string;
  readonly risk: AiAssistantActionRisk;
  readonly status: AiAssistantActionStatus;
  readonly inputSummary: Record<string, unknown>;
  readonly requestedAt: string;
  readonly resolvedAt: string | null;
  readonly updatedAt: string;
}

export interface ListAiProviderConfigsResponse {
  readonly providers: readonly AiProviderConfigDto[];
}

export interface CreateAiProviderConfigRequest {
  readonly providerKind: AiProviderKind;
  readonly displayName: string;
  readonly baseUrl?: string | null;
  readonly status?: Exclude<AiProviderStatus, "revoked">;
  readonly authMethod?: AiAuthMethod;
  readonly credentialPayload?: Record<string, unknown>;
}

export interface CreateAiProviderConfigResponse {
  readonly provider: AiProviderConfigDto;
}

export interface UpdateAiProviderConfigRequest {
  readonly providerKind?: AiProviderKind;
  readonly displayName?: string;
  readonly baseUrl?: string | null;
  readonly status?: Exclude<AiProviderStatus, "revoked">;
  readonly authMethod?: AiAuthMethod;
  readonly credentialPayload?: Record<string, unknown>;
}

export interface UpdateAiProviderConfigResponse {
  readonly provider: AiProviderConfigDto;
}

export interface RevokeAiProviderConfigResponse {
  readonly provider: AiProviderConfigDto;
}

export interface ListAiConfiguredModelsResponse {
  readonly models: readonly AiConfiguredModelDto[];
}

export interface CreateAiConfiguredModelRequest {
  readonly providerConfigId: string;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly capabilities: readonly AiModelCapability[];
  readonly status?: AiModelStatus;
}

export interface CreateAiConfiguredModelResponse {
  readonly model: AiConfiguredModelDto;
}

export interface UpdateAiConfiguredModelRequest {
  readonly providerModelId?: string;
  readonly displayName?: string;
  readonly capabilities?: readonly AiModelCapability[];
  readonly status?: AiModelStatus;
}

export interface UpdateAiConfiguredModelResponse {
  readonly model: AiConfiguredModelDto;
}

export interface LookupAiCapabilityRouteResponse {
  readonly route: AiCapabilityRouteDto;
}

export interface ListAiAssistantToolsResponse {
  readonly tools: readonly AiAssistantToolDto[];
}

export interface InvokeAiAssistantToolResponse {
  readonly invocation: AiAssistantToolInvocationDto;
}

export interface ListAiAssistantActionsResponse {
  readonly actions: readonly AiAssistantActionDto[];
}

export interface ResolveAiAssistantActionRequest {
  readonly status: ResolveAiAssistantActionStatus;
}

export interface ResolveAiAssistantActionResponse {
  readonly action: AiAssistantActionDto;
}

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: { type: "string" }
  }
} as const;

const jsonObjectSchema = {
  type: "object",
  additionalProperties: true
} as const;

const nullableJsonObjectSchema = {
  anyOf: [jsonObjectSchema, { type: "null" }]
} as const;

const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string" }
  }
} as const;

export const aiProviderKindSchema = {
  type: "string",
  enum: ["openai-compatible", "anthropic", "google", "ollama", "custom"]
} as const;

export const aiProviderStatusSchema = {
  type: "string",
  enum: ["active", "error", "disabled", "revoked"]
} as const;

export const writableAiProviderStatusSchema = {
  type: "string",
  enum: ["active", "error", "disabled"]
} as const;

export const aiModelStatusSchema = {
  type: "string",
  enum: ["active", "disabled"]
} as const;

export const aiModelCapabilitySchema = {
  type: "string",
  enum: ["chat", "tool-use", "json", "vision", "summarization"]
} as const;

const aiCapabilityParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["capability"],
  properties: {
    capability: aiModelCapabilitySchema
  }
} as const;

const aiAssistantToolParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string" }
  }
} as const;

export const aiAuthMethodSchema = {
  type: "string",
  enum: ["cli", "api_key"]
} as const;

const aiProviderConfigSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "providerKind",
    "displayName",
    "baseUrl",
    "status",
    "authMethod",
    "hasCredential",
    "cliAvailable",
    "revokedAt",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    providerKind: aiProviderKindSchema,
    displayName: { type: "string" },
    baseUrl: { type: ["string", "null"] },
    status: aiProviderStatusSchema,
    authMethod: aiAuthMethodSchema,
    hasCredential: { type: "boolean" },
    cliAvailable: { type: "boolean" },
    revokedAt: { type: ["string", "null"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

const aiConfiguredModelSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "providerConfigId",
    "providerKind",
    "providerDisplayName",
    "providerStatus",
    "providerModelId",
    "displayName",
    "capabilities",
    "status",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    providerConfigId: { type: "string" },
    providerKind: aiProviderKindSchema,
    providerDisplayName: { type: "string" },
    providerStatus: aiProviderStatusSchema,
    providerModelId: { type: "string" },
    displayName: { type: "string" },
    capabilities: { type: "array", items: aiModelCapabilitySchema },
    status: aiModelStatusSchema,
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

const aiCapabilityRouteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["capability", "available", "reason", "model"],
  properties: {
    capability: aiModelCapabilitySchema,
    available: { type: "boolean" },
    reason: { type: "string", enum: ["matched-active-model", "no-active-model"] },
    model: {
      anyOf: [aiConfiguredModelSchema, { type: "null" }]
    }
  }
} as const;

const aiAssistantToolSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "moduleId",
    "moduleName",
    "name",
    "description",
    "permissionId",
    "risk",
    "inputSchema",
    "outputSchema"
  ],
  properties: {
    moduleId: { type: "string" },
    moduleName: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    permissionId: { type: "string" },
    risk: { type: "string", enum: ["read", "write", "destructive"] },
    inputSchema: nullableJsonObjectSchema,
    outputSchema: nullableJsonObjectSchema
  }
} as const;

const aiAssistantToolInvocationStatusSchema = {
  type: "string",
  enum: ["succeeded", "blocked"]
} as const;

const nullableAiAssistantToolBlockedReasonSchema = {
  anyOf: [
    { type: "string", enum: ["confirmation_required", "non_read_risk", "unsupported_tool"] },
    { type: "null" }
  ]
} as const;

const aiAssistantActionRiskSchema = {
  type: "string",
  enum: ["write", "destructive"]
} as const;

const aiAssistantActionStatusSchema = {
  type: "string",
  enum: ["pending", "confirmed", "rejected", "cancelled"]
} as const;

const resolveAiAssistantActionStatusSchema = {
  type: "string",
  enum: ["confirmed", "rejected", "cancelled"]
} as const;

const aiAssistantToolInvocationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "moduleId",
    "moduleName",
    "name",
    "description",
    "permissionId",
    "risk",
    "status",
    "blockedReason",
    "actionRequestId",
    "result"
  ],
  properties: {
    moduleId: { type: "string" },
    moduleName: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    permissionId: { type: "string" },
    risk: { type: "string", enum: ["read", "write", "destructive"] },
    status: aiAssistantToolInvocationStatusSchema,
    blockedReason: nullableAiAssistantToolBlockedReasonSchema,
    actionRequestId: { type: ["string", "null"] },
    result: nullableJsonObjectSchema
  }
} as const;

const aiAssistantActionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "ownerUserId",
    "toolModuleId",
    "toolModuleName",
    "toolName",
    "permissionId",
    "risk",
    "status",
    "inputSummary",
    "requestedAt",
    "resolvedAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    toolModuleId: { type: "string" },
    toolModuleName: { type: "string" },
    toolName: { type: "string" },
    permissionId: { type: "string" },
    risk: aiAssistantActionRiskSchema,
    status: aiAssistantActionStatusSchema,
    inputSummary: jsonObjectSchema,
    requestedAt: { type: "string" },
    resolvedAt: { type: ["string", "null"] },
    updatedAt: { type: "string" }
  }
} as const;

export const createAiProviderConfigRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["providerKind", "displayName"],
  properties: {
    providerKind: aiProviderKindSchema,
    displayName: { type: "string" },
    baseUrl: { type: ["string", "null"] },
    status: writableAiProviderStatusSchema,
    authMethod: aiAuthMethodSchema,
    credentialPayload: jsonObjectSchema
  }
} as const;

export const updateAiProviderConfigRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    providerKind: aiProviderKindSchema,
    displayName: { type: "string" },
    baseUrl: { type: ["string", "null"] },
    status: writableAiProviderStatusSchema,
    authMethod: aiAuthMethodSchema,
    credentialPayload: jsonObjectSchema
  }
} as const;

export const createAiConfiguredModelRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["providerConfigId", "providerModelId", "displayName", "capabilities"],
  properties: {
    providerConfigId: { type: "string" },
    providerModelId: { type: "string" },
    displayName: { type: "string" },
    capabilities: {
      type: "array",
      minItems: 1,
      items: aiModelCapabilitySchema
    },
    status: aiModelStatusSchema
  }
} as const;

export const updateAiConfiguredModelRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    providerModelId: { type: "string" },
    displayName: { type: "string" },
    capabilities: {
      type: "array",
      minItems: 1,
      items: aiModelCapabilitySchema
    },
    status: aiModelStatusSchema
  }
} as const;

export const invokeAiAssistantToolRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    input: jsonObjectSchema
  }
} as const;

export const resolveAiAssistantActionRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: resolveAiAssistantActionStatusSchema
  }
} as const;

export const listAiProviderConfigsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["providers"],
  properties: {
    providers: { type: "array", items: aiProviderConfigSchema }
  }
} as const;

export const createAiProviderConfigResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["provider"],
  properties: {
    provider: aiProviderConfigSchema
  }
} as const;

export const updateAiProviderConfigResponseSchema = createAiProviderConfigResponseSchema;
export const revokeAiProviderConfigResponseSchema = createAiProviderConfigResponseSchema;

export const listAiConfiguredModelsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["models"],
  properties: {
    models: { type: "array", items: aiConfiguredModelSchema }
  }
} as const;

export const createAiConfiguredModelResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["model"],
  properties: {
    model: aiConfiguredModelSchema
  }
} as const;

export const updateAiConfiguredModelResponseSchema = createAiConfiguredModelResponseSchema;

export const lookupAiCapabilityRouteResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["route"],
  properties: {
    route: aiCapabilityRouteSchema
  }
} as const;

export const listAiAssistantToolsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tools"],
  properties: {
    tools: { type: "array", items: aiAssistantToolSchema }
  }
} as const;

export const invokeAiAssistantToolResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["invocation"],
  properties: {
    invocation: aiAssistantToolInvocationSchema
  }
} as const;

export const listAiAssistantActionsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["actions"],
  properties: {
    actions: { type: "array", items: aiAssistantActionSchema }
  }
} as const;

export const resolveAiAssistantActionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: aiAssistantActionSchema
  }
} as const;

export const listAiProviderConfigsRouteSchema = {
  response: {
    200: listAiProviderConfigsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const createAiProviderConfigRouteSchema = {
  body: createAiProviderConfigRequestSchema,
  response: {
    201: createAiProviderConfigResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const updateAiProviderConfigRouteSchema = {
  params: idParamsSchema,
  body: updateAiProviderConfigRequestSchema,
  response: {
    200: updateAiProviderConfigResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const revokeAiProviderConfigRouteSchema = {
  params: idParamsSchema,
  response: {
    200: revokeAiProviderConfigResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const listAiConfiguredModelsRouteSchema = {
  response: {
    200: listAiConfiguredModelsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const createAiConfiguredModelRouteSchema = {
  body: createAiConfiguredModelRequestSchema,
  response: {
    201: createAiConfiguredModelResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const updateAiConfiguredModelRouteSchema = {
  params: idParamsSchema,
  body: updateAiConfiguredModelRequestSchema,
  response: {
    200: updateAiConfiguredModelResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const lookupAiCapabilityRouteRouteSchema = {
  params: aiCapabilityParamsSchema,
  response: {
    200: lookupAiCapabilityRouteResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const listAiAssistantToolsRouteSchema = {
  response: {
    200: listAiAssistantToolsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const invokeAiAssistantToolRouteSchema = {
  params: aiAssistantToolParamsSchema,
  body: invokeAiAssistantToolRequestSchema,
  response: {
    200: invokeAiAssistantToolResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: invokeAiAssistantToolResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const listAiAssistantActionsRouteSchema = {
  response: {
    200: listAiAssistantActionsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const resolveAiAssistantActionRouteSchema = {
  params: idParamsSchema,
  body: resolveAiAssistantActionRequestSchema,
  response: {
    200: resolveAiAssistantActionResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;
