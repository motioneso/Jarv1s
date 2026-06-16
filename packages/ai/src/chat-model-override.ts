export const CHAT_MODEL_OVERRIDE_PREFERENCE_KEY = "chat.modelOverride";
export const CHAT_MODEL_OVERRIDE_SETTING_KEY = "ai.chat_model_override.enabled";

export interface ChatModelOverrideCandidate {
  readonly id: string;
  readonly providerStatus: "active" | "error" | "disabled" | "revoked";
  readonly capabilities: readonly string[];
  readonly status: "active" | "disabled";
  readonly allowUserOverride: boolean;
}

export interface ResolveChatModelOverrideInput<T extends ChatModelOverrideCandidate> {
  readonly defaultModel: T | null | undefined;
  readonly requestedModelId: string | null | undefined;
  readonly overrideEnabled: boolean;
  readonly models: readonly T[];
}

export interface ResolveChatModelOverrideResult<T extends ChatModelOverrideCandidate> {
  readonly selectedModel: T | null;
  readonly effectiveOverrideModelId: string | null;
  readonly allowedModels: readonly T[];
}

export function resolveChatModelOverride<T extends ChatModelOverrideCandidate>(
  input: ResolveChatModelOverrideInput<T>
): ResolveChatModelOverrideResult<T> {
  const candidates = input.models.filter(isActiveChatModel);
  const defaultModel =
    input.defaultModel && isActiveChatModel(input.defaultModel) ? input.defaultModel : null;
  const allowed = candidates.filter((model) => model.allowUserOverride);
  const allowedModels =
    defaultModel && !allowed.some((model) => model.id === defaultModel.id)
      ? [defaultModel, ...allowed]
      : allowed;
  const override = input.overrideEnabled
    ? allowed.find((model) => model.id === input.requestedModelId)
    : undefined;
  const selectedModel = override ?? defaultModel;

  return {
    selectedModel,
    effectiveOverrideModelId: override?.id ?? null,
    allowedModels
  };
}

function isActiveChatModel(model: ChatModelOverrideCandidate): boolean {
  return (
    model.status === "active" &&
    model.providerStatus === "active" &&
    model.capabilities.includes("chat")
  );
}
