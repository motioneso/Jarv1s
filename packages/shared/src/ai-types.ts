export type AiProviderKind = "openai-compatible" | "anthropic" | "google" | "ollama" | "custom";
export type AiProviderStatus = "active" | "error" | "disabled" | "revoked";
export type AiAuthMethod = "cli" | "api_key";
export type AiModelStatus = "active" | "disabled";
export type AiModelTier = "reasoning" | "interactive" | "economy";
export type AiModelCapability = "chat" | "tool-use" | "json" | "vision" | "summarization";
export type AiCapabilityRouteReason =
  | "admin-pin"
  | "admin-pin-unavailable-fallback"
  | "manual-route"
  | "manual-route-unavailable-fallback"
  | "matched-active-model"
  | "no-active-model";

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
  readonly providerConfigId: string | null;
  readonly providerKind: AiProviderKind | null;
  readonly providerDisplayName: string;
  readonly providerStatus: AiProviderStatus;
  readonly providerModelId: string | null;
  readonly displayName: string;
  readonly capabilities: readonly AiModelCapability[];
  readonly status: AiModelStatus;
  readonly tier: AiModelTier;
  readonly allowUserOverride: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AiCapabilityRouteDto {
  readonly capability: AiModelCapability;
  readonly available: boolean;
  readonly reason: AiCapabilityRouteReason;
  readonly model: AiConfiguredModelDto | null;
}

export type AiCapabilityRouteMapDto = Partial<Record<AiModelCapability, string | null>>;

export interface AiProviderTestResultDto {
  readonly ok: boolean;
  readonly providerKind: AiProviderKind;
  readonly message: string;
}

export interface AiProviderDiscoveredModelDto {
  readonly providerModelId: string;
  readonly displayName: string;
  readonly capabilities: readonly AiModelCapability[];
  readonly tier: AiModelTier;
}

export interface AiDiscoverModelsItemDto extends AiProviderDiscoveredModelDto {
  readonly fromCache: boolean;
  readonly fromFallback: boolean;
}

export interface AiDiscoverModelsResponse {
  readonly models: readonly AiDiscoverModelsItemDto[];
  readonly fromFallback: boolean;
  readonly cacheExpiresAt: string | null;
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
  readonly tier?: AiModelTier;
  readonly allowUserOverride?: boolean;
}

export interface CreateAiConfiguredModelResponse {
  readonly model: AiConfiguredModelDto;
}

export interface UpdateAiConfiguredModelRequest {
  readonly providerModelId?: string;
  readonly displayName?: string;
  readonly capabilities?: readonly AiModelCapability[];
  readonly status?: AiModelStatus;
  readonly tier?: AiModelTier;
  readonly allowUserOverride?: boolean;
}

export interface UpdateAiConfiguredModelResponse {
  readonly model: AiConfiguredModelDto;
}

export interface LookupAiCapabilityRouteResponse {
  readonly route: AiCapabilityRouteDto;
}

export interface ListAiCapabilityRoutesResponse {
  readonly routes: AiCapabilityRouteMapDto;
}

export interface PutAiCapabilityRouteRequest {
  readonly modelId: string | null;
}

export interface PutAiCapabilityRouteResponse {
  readonly route: {
    readonly capability: AiModelCapability;
    readonly modelId: string | null;
  };
}

export interface TestAiProviderConfigResponse {
  readonly result: AiProviderTestResultDto;
}

export interface DiscoverAiProviderModelsResponse {
  readonly models: readonly AiProviderDiscoveredModelDto[];
}

export interface ChatModelOverrideSettingsDto {
  readonly overrideEnabled: boolean;
  readonly currentOverrideModelId: string | null;
  readonly effectiveOverrideModelId: string | null;
  readonly defaultModel: AiConfiguredModelDto | null;
  readonly selectedModel: AiConfiguredModelDto | null;
  readonly selectableOverrideModels: readonly AiConfiguredModelDto[];
}

export interface GetChatModelOverrideSettingsResponse {
  readonly settings: ChatModelOverrideSettingsDto;
}

export interface PutChatModelOverrideRequest {
  readonly modelId: string | null;
}

export interface PutChatModelOverrideSettingsResponse {
  readonly settings: ChatModelOverrideSettingsDto;
}

export interface PutAdminChatModelOverrideRequest {
  readonly enabled: boolean;
}

export interface AiAdminUserPinDto {
  readonly pinnedModelId: string | null;
  readonly pinnedModel: AiConfiguredModelDto | null;
  readonly effectiveChatModel: AiConfiguredModelDto | null;
  readonly effectiveChatReason: AiCapabilityRouteReason;
  readonly availableModels: readonly AiConfiguredModelDto[];
}

export interface GetAiAdminUserPinResponse {
  readonly pin: AiAdminUserPinDto;
}

export interface PutAiAdminUserPinRequest {
  readonly modelId: string | null;
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

export interface AiCapabilityTierPreferencesResponse {
  readonly preferences: Partial<Record<AiModelCapability, AiModelTier>>;
}

export interface PatchAiCapabilityTierPreferenceRequest {
  readonly capability: AiModelCapability;
  readonly tier: AiModelTier;
}
