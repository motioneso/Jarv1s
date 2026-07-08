export type AiProviderKind = "openai-compatible" | "anthropic" | "google" | "ollama" | "custom";
export type AiProviderStatus = "active" | "error" | "disabled" | "revoked";
export type AiAuthMethod = "cli" | "api_key";
export type AiProviderExecutionMode = "interactive" | "non_interactive";
export type AiModelStatus = "active" | "disabled";
export type AiModelTier = "reasoning" | "interactive" | "economy";
export type AiModelCapability =
  | "chat"
  | "tool-use"
  | "json"
  | "vision"
  | "summarization"
  | "transcription";

/**
 * Canonical, single-source-of-truth list of recognized capabilities. Every place that
 * validates/enumerates capabilities (route param parsing, capability-route map schema,
 * settings UI) should derive from this instead of hand-maintaining a parallel literal set —
 * a capability added here and forgotten elsewhere silently 400s or drops from routing.
 */
export const AI_MODEL_CAPABILITIES: readonly AiModelCapability[] = [
  "chat",
  "tool-use",
  "json",
  "vision",
  "summarization",
  "transcription"
];
export type AiCapabilityRouteReason =
  | "admin-pin"
  | "admin-pin-unavailable"
  | "admin-pin-unavailable-fallback"
  | "manual-route"
  | "manual-route-unavailable-fallback"
  | "matched-active-model"
  | "no-active-model"
  // #870 Slice 1: explicit "an admin must configure this" state for user-facing services
  // (Chat/Voice). Distinct from `no-active-model` (worker cross-provider miss) on purpose — the UI
  // renders needs-config as an actionable admin prompt, not a silent worker skip. See resolver.
  | "needs-config";

export interface AiProviderConfigDto {
  readonly id: string;
  readonly providerKind: AiProviderKind;
  readonly displayName: string;
  readonly baseUrl: string | null;
  readonly status: AiProviderStatus;
  readonly authMethod: AiAuthMethod;
  readonly executionMode: AiProviderExecutionMode;
  readonly hasCredential: boolean;
  readonly cliAvailable: boolean;
  // #870/H1 Slice 1: the single instance-default provider. User-facing services bound to a "mode"
  // (tier) resolve their model INSIDE this provider. Globally single-valued (DB partial unique
  // index in migration 0147); the UI renders it as a mutually-exclusive radio across providers.
  readonly isInstanceDefault: boolean;
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

/**
 * #870 Slice 1: a per-service binding. The admin binds each user-facing service (Chat, Voice) to
 * EITHER a "mode" (a tier resolved inside the instance-default provider) OR a specific model. This
 * replaces the old free-for-all per-capability model route + separate per-user tier preference with
 * one unified knob per service. Stored under `ai.service_bindings` in `app.instance_settings`.
 */
export type AiServiceBinding =
  | { readonly kind: "mode"; readonly tier: AiModelTier }
  | { readonly kind: "model"; readonly modelId: string };

export type AiServiceBindingMapDto = Partial<Record<AiModelCapability, AiServiceBinding>>;

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
  readonly executionMode?: AiProviderExecutionMode;
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
  readonly executionMode?: AiProviderExecutionMode;
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

/**
 * Response for POST /api/ai/transcriptions. Transcript text only — the raw audio that
 * produced it is never stored, logged, or echoed back (secrets/private-data-never-escape
 * invariant extends to transient uploads, not just credentials).
 */
export interface TranscribeAudioResponse {
  readonly text: string;
}

export interface ListAiServiceBindingsResponse {
  readonly bindings: AiServiceBindingMapDto;
}

export interface PutAiServiceBindingRequest {
  readonly binding: AiServiceBinding;
}

export interface PutAiServiceBindingResponse {
  readonly service: AiModelCapability;
  readonly binding: AiServiceBinding;
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
  // #870 Slice 1 (D8): an admin may pin a whole PROVIDER for a user instead of a single model. A
  // provider pin hard-locks ALL of that user's traffic (chat + voice + workers) to that provider —
  // model pin and provider pin are mutually exclusive (the handler enforces at-most-one).
  readonly pinnedProviderId: string | null;
  readonly pinnedProvider: AiProviderConfigDto | null;
  readonly effectiveChatModel: AiConfiguredModelDto | null;
  readonly effectiveChatReason: AiCapabilityRouteReason;
  readonly availableModels: readonly AiConfiguredModelDto[];
  readonly availableProviders: readonly AiProviderConfigDto[];
}

export interface GetAiAdminUserPinResponse {
  readonly pin: AiAdminUserPinDto;
}

export interface PutAiAdminUserPinRequest {
  // At most one of modelId/providerId may be non-null (mutually exclusive pin kinds, M4a). Both
  // null clears the pin.
  readonly modelId?: string | null;
  readonly providerId?: string | null;
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
