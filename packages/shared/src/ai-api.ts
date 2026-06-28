import {
  errorResponseSchema,
  idParamsSchema,
  jsonObjectSchema,
  nullableJsonObjectSchema
} from "./schema-fragments.js";

export * from "./ai-types.js";

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

export const aiModelTierSchema = {
  type: "string",
  enum: ["reasoning", "interactive", "economy"]
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

export const aiProviderExecutionModeSchema = {
  type: "string",
  enum: ["interactive", "non_interactive"]
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
    "executionMode",
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
    executionMode: aiProviderExecutionModeSchema,
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
    "tier",
    "allowUserOverride",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    providerConfigId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    providerKind: { anyOf: [aiProviderKindSchema, { type: "null" }] },
    providerDisplayName: { type: "string" },
    providerStatus: aiProviderStatusSchema,
    providerModelId: { anyOf: [{ type: "string" }, { type: "null" }] },
    displayName: { type: "string" },
    capabilities: { type: "array", items: aiModelCapabilitySchema },
    status: aiModelStatusSchema,
    tier: aiModelTierSchema,
    allowUserOverride: { type: "boolean" },
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
    reason: {
      type: "string",
      enum: [
        "admin-pin",
        "admin-pin-unavailable-fallback",
        "manual-route",
        "manual-route-unavailable-fallback",
        "matched-active-model",
        "no-active-model"
      ]
    },
    model: {
      anyOf: [aiConfiguredModelSchema, { type: "null" }]
    }
  }
} as const;

const aiCapabilityRouteMapSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    chat: { type: ["string", "null"] },
    "tool-use": { type: ["string", "null"] },
    json: { type: ["string", "null"] },
    vision: { type: ["string", "null"] },
    summarization: { type: ["string", "null"] }
  }
} as const;

const aiCapabilityRouteSettingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["capability", "modelId"],
  properties: {
    capability: aiModelCapabilitySchema,
    modelId: { type: ["string", "null"] }
  }
} as const;

const aiProviderTestResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "providerKind", "message"],
  properties: {
    ok: { type: "boolean" },
    providerKind: aiProviderKindSchema,
    message: { type: "string" }
  }
} as const;

const aiProviderDiscoveredModelSchema = {
  type: "object",
  additionalProperties: false,
  required: ["providerModelId", "displayName", "capabilities", "tier"],
  properties: {
    providerModelId: { type: "string" },
    displayName: { type: "string" },
    capabilities: { type: "array", minItems: 1, items: aiModelCapabilitySchema },
    tier: aiModelTierSchema
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

const aiAdminUserParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["userId"],
  properties: {
    userId: { type: "string", format: "uuid" }
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
    executionMode: aiProviderExecutionModeSchema,
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
    executionMode: aiProviderExecutionModeSchema,
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
    status: aiModelStatusSchema,
    tier: aiModelTierSchema,
    allowUserOverride: { type: "boolean" }
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
    status: aiModelStatusSchema,
    tier: aiModelTierSchema,
    allowUserOverride: { type: "boolean" }
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

export const testAiProviderConfigResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["result"],
  properties: {
    result: aiProviderTestResultSchema
  }
} as const;

export const discoverAiProviderModelsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["models"],
  properties: {
    models: { type: "array", items: aiProviderDiscoveredModelSchema }
  }
} as const;

const aiDiscoverModelsItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["providerModelId", "displayName", "capabilities", "tier", "fromCache", "fromFallback"],
  properties: {
    providerModelId: { type: "string" },
    displayName: { type: "string" },
    capabilities: { type: "array", minItems: 0, items: aiModelCapabilitySchema },
    tier: aiModelTierSchema,
    fromCache: { type: "boolean" },
    fromFallback: { type: "boolean" }
  }
} as const;

export const aiDiscoverModelsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["models", "fromFallback", "cacheExpiresAt"],
  properties: {
    models: { type: "array", items: aiDiscoverModelsItemSchema },
    fromFallback: { type: "boolean" },
    cacheExpiresAt: { type: "string", nullable: true }
  }
} as const;

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

export const listAiCapabilityRoutesResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["routes"],
  properties: {
    routes: aiCapabilityRouteMapSchema
  }
} as const;

export const putAiCapabilityRouteRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["modelId"],
  properties: {
    modelId: { type: ["string", "null"] }
  }
} as const;

export const putAiCapabilityRouteResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["route"],
  properties: {
    route: aiCapabilityRouteSettingSchema
  }
} as const;

const chatModelOverrideSettingsSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "overrideEnabled",
    "currentOverrideModelId",
    "effectiveOverrideModelId",
    "defaultModel",
    "selectedModel",
    "selectableOverrideModels"
  ],
  properties: {
    overrideEnabled: { type: "boolean" },
    currentOverrideModelId: { type: ["string", "null"] },
    effectiveOverrideModelId: { type: ["string", "null"] },
    defaultModel: { anyOf: [aiConfiguredModelSchema, { type: "null" }] },
    selectedModel: { anyOf: [aiConfiguredModelSchema, { type: "null" }] },
    selectableOverrideModels: { type: "array", items: aiConfiguredModelSchema }
  }
} as const;

export const getChatModelOverrideSettingsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["settings"],
  properties: {
    settings: chatModelOverrideSettingsSchema
  }
} as const;

export const putChatModelOverrideRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["modelId"],
  properties: {
    modelId: { type: ["string", "null"] }
  }
} as const;

export const putAdminChatModelOverrideRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["enabled"],
  properties: {
    enabled: { type: "boolean" }
  }
} as const;

export const putAiAdminUserPinRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["modelId"],
  properties: {
    modelId: { type: ["string", "null"] }
  }
} as const;

const aiAdminUserPinSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "pinnedModelId",
    "pinnedModel",
    "effectiveChatModel",
    "effectiveChatReason",
    "availableModels"
  ],
  properties: {
    pinnedModelId: { type: ["string", "null"] },
    pinnedModel: { anyOf: [aiConfiguredModelSchema, { type: "null" }] },
    effectiveChatModel: { anyOf: [aiConfiguredModelSchema, { type: "null" }] },
    effectiveChatReason: aiCapabilityRouteSchema.properties.reason,
    availableModels: { type: "array", items: aiConfiguredModelSchema }
  }
} as const;

export const getAiAdminUserPinResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pin"],
  properties: {
    pin: aiAdminUserPinSchema
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
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const updateAiProviderConfigRouteSchema = {
  params: idParamsSchema,
  body: updateAiProviderConfigRequestSchema,
  response: {
    200: updateAiProviderConfigResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const revokeAiProviderConfigRouteSchema = {
  params: idParamsSchema,
  response: {
    200: revokeAiProviderConfigResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const testAiProviderConfigRouteSchema = {
  params: idParamsSchema,
  response: {
    200: testAiProviderConfigResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const discoverAiProviderModelsRouteSchema = {
  params: idParamsSchema,
  response: {
    200: discoverAiProviderModelsResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const aiDiscoverModelsRouteSchema = {
  params: idParamsSchema,
  response: {
    200: aiDiscoverModelsResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
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
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const updateAiConfiguredModelRouteSchema = {
  params: idParamsSchema,
  body: updateAiConfiguredModelRequestSchema,
  response: {
    200: updateAiConfiguredModelResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
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

export const listAiCapabilityRoutesRouteSchema = {
  response: {
    200: listAiCapabilityRoutesResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const putAiCapabilityRouteRouteSchema = {
  params: aiCapabilityParamsSchema,
  body: putAiCapabilityRouteRequestSchema,
  response: {
    200: putAiCapabilityRouteResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const getChatModelOverrideSettingsRouteSchema = {
  response: {
    200: getChatModelOverrideSettingsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const putChatModelOverrideSettingsRouteSchema = {
  body: putChatModelOverrideRequestSchema,
  response: {
    200: getChatModelOverrideSettingsResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const putAdminChatModelOverrideSettingsRouteSchema = {
  body: putAdminChatModelOverrideRequestSchema,
  response: {
    200: getChatModelOverrideSettingsResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const getAiAdminUserPinRouteSchema = {
  params: aiAdminUserParamsSchema,
  response: {
    200: getAiAdminUserPinResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const putAiAdminUserPinRouteSchema = {
  params: aiAdminUserParamsSchema,
  body: putAiAdminUserPinRequestSchema,
  response: {
    200: getAiAdminUserPinResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
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

export const aiCapabilityTierPreferencesResponseSchema = {
  type: "object",
  properties: {
    preferences: {
      type: "object",
      additionalProperties: aiModelTierSchema
    }
  },
  required: ["preferences"]
} as const;

export const patchAiCapabilityTierPreferenceRequestSchema = {
  type: "object",
  properties: {
    capability: aiModelCapabilitySchema,
    tier: aiModelTierSchema
  },
  required: ["capability", "tier"]
} as const;

export const listAiCapabilityTierPreferencesRouteSchema = {
  response: {
    200: aiCapabilityTierPreferencesResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const patchAiCapabilityTierPreferenceRouteSchema = {
  body: patchAiCapabilityTierPreferenceRequestSchema,
  response: {
    204: { type: "null" },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const aiActionPolicyDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: ["moduleId", "actionFamilyId", "tier"],
  properties: {
    moduleId: { type: "string" },
    actionFamilyId: { type: "string" },
    tier: { type: "string", enum: ["ask_each_time", "trusted_auto", "always_confirm"] }
  }
} as const;

export const getAiActionPoliciesResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["policies"],
  properties: {
    policies: { type: "array", items: aiActionPolicyDtoSchema }
  }
} as const;

export const patchAiActionPolicyRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tier"],
  properties: {
    tier: { type: "string", enum: ["ask_each_time", "trusted_auto", "always_confirm"] }
  }
} as const;

export const patchAiActionPolicyResponseSchema = aiActionPolicyDtoSchema;

const actionAuditLogEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "ownerUserId",
    "toolModuleId",
    "toolName",
    "actionFamilyId",
    "actionKind",
    "approvalMode",
    "outcome",
    "errorClass",
    "requestId",
    "chatSessionId",
    "sourceSurface",
    "occurredAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    toolModuleId: { type: "string" },
    toolName: { type: "string" },
    actionFamilyId: { type: ["string", "null"] },
    actionKind: { type: "string", enum: ["write", "destructive"] },
    approvalMode: {
      type: "string",
      enum: ["auto", "confirmed", "rejected", "cancelled", "timeout"]
    },
    outcome: {
      type: "string",
      enum: ["success", "failed", "denied", "cancelled"]
    },
    errorClass: { type: ["string", "null"] },
    requestId: { type: ["string", "null"] },
    chatSessionId: { type: ["string", "null"] },
    sourceSurface: {
      type: "string",
      enum: ["chat", "proactive", "scheduled", "unknown"]
    },
    occurredAt: { type: "string" }
  }
} as const;

export const listActionAuditLogResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: { type: "array", items: actionAuditLogEntrySchema }
  }
} as const;

export const listActionAuditLogRouteSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      since: { type: "string" },
      family: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 500 }
    }
  },
  response: {
    200: listActionAuditLogResponseSchema
  }
} as const;

export type ActionAuditLogEntryDto = {
  readonly id: string;
  readonly ownerUserId: string;
  readonly toolModuleId: string;
  readonly toolName: string;
  readonly actionFamilyId: string | null;
  readonly actionKind: "write" | "destructive";
  readonly approvalMode: "auto" | "confirmed" | "rejected" | "cancelled" | "timeout";
  readonly outcome: "success" | "failed" | "denied" | "cancelled";
  readonly errorClass: string | null;
  readonly requestId: string | null;
  readonly chatSessionId: string | null;
  readonly sourceSurface: "chat" | "proactive" | "scheduled" | "unknown";
  readonly occurredAt: string;
};

export type ListActionAuditLogResponse = {
  readonly entries: readonly ActionAuditLogEntryDto[];
};
