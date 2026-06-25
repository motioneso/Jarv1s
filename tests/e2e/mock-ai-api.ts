import type { Page, Route } from "@playwright/test";
import type {
  AiAssistantToolDto,
  AiCapabilityRouteMapDto,
  AiConfiguredModelDto,
  AiModelCapability,
  AiProviderConfigDto,
  CreateAiConfiguredModelRequest,
  CreateAiProviderConfigRequest,
  PutAiCapabilityRouteRequest,
  UpdateAiConfiguredModelRequest,
  UpdateAiProviderConfigRequest
} from "@jarv1s/shared";

export interface MockAiApiState {
  aiCapabilityRoutes?: AiCapabilityRouteMapDto;
  aiModels?: AiConfiguredModelDto[];
  aiProviders?: AiProviderConfigDto[];
}

export async function registerMockAiRoutes(page: Page, state: MockAiApiState): Promise<void> {
  const discoveredModels = [
    {
      providerModelId: "gpt-4o",
      displayName: "gpt-4o",
      capabilities: ["chat", "tool-use", "json", "summarization"],
      tier: "interactive",
      fromCache: false,
      fromFallback: false
    }
  ];
  await page.route(/\/api\/ai\/providers\/[^/]+\/test$/, (route) =>
    fulfillJson(route, 200, {
      result: {
        ok: true,
        providerKind: "openai-compatible",
        message: "Provider credential is valid."
      }
    })
  );
  await page.route(/\/api\/ai\/providers\/[^/]+\/models\/discover$/, (route) =>
    fulfillJson(route, 200, {
      models: discoveredModels,
      fromFallback: false,
      cacheExpiresAt: null
    })
  );
  await page.route(/\/api\/ai\/providers\/[^/]+\/discover-models$/, (route) =>
    fulfillJson(route, 200, {
      models: discoveredModels.map(
        ({ fromCache: _fromCache, fromFallback: _fromFallback, ...model }) => model
      )
    })
  );
  await page.route(/\/api\/ai\/providers\/[^/]+\/revoke$/, (route) =>
    handleAiProviderRevokeRoute(route, state)
  );
  await page.route(/\/api\/ai\/providers\/[^/]+$/, (route) =>
    handleAiProviderDetailRoute(route, state)
  );
  await page.route("**/api/ai/providers", (route) => handleAiProvidersRoute(route, state));
  await page.route(/\/api\/ai\/models\/[^/]+$/, (route) => handleAiModelDetailRoute(route, state));
  await page.route("**/api/ai/models", (route) => handleAiModelsRoute(route, state));
  await page.route(/\/api\/ai\/capability-route\/[^/]+$/, (route) =>
    handleAiCapabilityRoute(route, state)
  );
  await page.route("**/api/ai/capability-routes", (route) =>
    handleAiCapabilityRoutes(route, state)
  );
  await page.route(/\/api\/ai\/capability-routes\/[^/]+$/, (route) =>
    handleAiCapabilityRouteDetail(route, state)
  );
  await page.route("**/api/ai/capability-tier-preferences", (route) =>
    handleAiCapabilityTierPreferences(route, state)
  );
  await page.route("**/api/ai/chat-model-override", (route) =>
    fulfillJson(route, 200, {
      settings: {
        overrideEnabled: true,
        currentOverrideModelId: null,
        effectiveOverrideModelId: null,
        defaultModel: null,
        selectedModel: null,
        selectableOverrideModels: state.aiModels ?? []
      }
    })
  );
  await page.route("**/api/ai/assistant-tools", (route) =>
    fulfillJson(route, 200, { tools: createMockAiAssistantTools() })
  );
}

async function handleAiProvidersRoute(route: Route, state: MockAiApiState): Promise<void> {
  const request = route.request();

  if (request.method() === "GET") {
    return fulfillJson(route, 200, { providers: state.aiProviders ?? [] });
  }

  if (request.method() === "POST") {
    const input = request.postDataJSON() as CreateAiProviderConfigRequest;
    const provider = createMockAiProvider(`ai-provider-${(state.aiProviders ?? []).length + 1}`, {
      providerKind: input.providerKind,
      displayName: input.displayName,
      baseUrl: input.baseUrl ?? null,
      status: input.status ?? "active",
      hasCredential: true
    });

    state.aiProviders = [...(state.aiProviders ?? []), provider];
    return fulfillJson(route, 201, { provider });
  }

  return fulfillJson(route, 405, { error: "Method not allowed" });
}

async function handleAiProviderDetailRoute(route: Route, state: MockAiApiState): Promise<void> {
  const request = route.request();
  const providerId = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
  const provider = (state.aiProviders ?? []).find((item) => item.id === providerId);

  if (!provider) {
    return fulfillJson(route, 404, { error: "AI provider config not found" });
  }

  if (request.method() !== "PATCH") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const input = request.postDataJSON() as UpdateAiProviderConfigRequest;
  const updatedProvider: AiProviderConfigDto = {
    ...provider,
    providerKind: input.providerKind ?? provider.providerKind,
    displayName: input.displayName ?? provider.displayName,
    baseUrl: input.baseUrl === undefined ? provider.baseUrl : input.baseUrl,
    status: input.status ?? provider.status,
    hasCredential: input.credentialPayload === undefined ? provider.hasCredential : true,
    revokedAt: null,
    updatedAt: "2026-06-06T12:00:00.000Z"
  };

  state.aiProviders = (state.aiProviders ?? []).map((item) =>
    item.id === providerId ? updatedProvider : item
  );
  return fulfillJson(route, 200, { provider: updatedProvider });
}

async function handleAiProviderRevokeRoute(route: Route, state: MockAiApiState): Promise<void> {
  const request = route.request();
  const segments = new URL(request.url()).pathname.split("/");
  const providerId = decodeURIComponent(segments.at(-2) ?? "");
  const provider = (state.aiProviders ?? []).find((item) => item.id === providerId);

  if (!provider) {
    return fulfillJson(route, 404, { error: "AI provider config not found" });
  }

  if (request.method() !== "POST") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const revokedProvider: AiProviderConfigDto = {
    ...provider,
    status: "revoked",
    revokedAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z"
  };

  state.aiProviders = (state.aiProviders ?? []).map((item) =>
    item.id === providerId ? revokedProvider : item
  );
  return fulfillJson(route, 200, { provider: revokedProvider });
}

async function handleAiModelsRoute(route: Route, state: MockAiApiState): Promise<void> {
  const request = route.request();

  if (request.method() === "GET") {
    return fulfillJson(route, 200, { models: state.aiModels ?? [] });
  }

  if (request.method() === "POST") {
    const input = request.postDataJSON() as CreateAiConfiguredModelRequest;
    const provider = (state.aiProviders ?? []).find((item) => item.id === input.providerConfigId);

    if (!provider) {
      return fulfillJson(route, 400, { error: "AI configuration request is invalid" });
    }

    const model = createMockAiModel(`ai-model-${(state.aiModels ?? []).length + 1}`, {
      providerConfigId: provider.id,
      providerKind: provider.providerKind,
      providerDisplayName: provider.displayName,
      providerStatus: provider.status,
      providerModelId: input.providerModelId,
      displayName: input.displayName,
      capabilities: input.capabilities,
      status: input.status ?? "active",
      tier: input.tier ?? "interactive",
      allowUserOverride: input.allowUserOverride ?? true
    });

    state.aiModels = [...(state.aiModels ?? []), model];
    return fulfillJson(route, 201, { model });
  }

  return fulfillJson(route, 405, { error: "Method not allowed" });
}

async function handleAiModelDetailRoute(route: Route, state: MockAiApiState): Promise<void> {
  const request = route.request();
  const modelId = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
  const model = (state.aiModels ?? []).find((item) => item.id === modelId);

  if (!model) {
    return fulfillJson(route, 404, { error: "AI model config not found" });
  }

  if (request.method() !== "PATCH") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const input = request.postDataJSON() as UpdateAiConfiguredModelRequest;
  const updatedModel: AiConfiguredModelDto = {
    ...model,
    providerModelId: input.providerModelId ?? model.providerModelId,
    displayName: input.displayName ?? model.displayName,
    capabilities: input.capabilities ?? model.capabilities,
    status: input.status ?? model.status,
    updatedAt: "2026-06-06T12:00:00.000Z"
  };

  state.aiModels = (state.aiModels ?? []).map((item) =>
    item.id === modelId ? updatedModel : item
  );
  return fulfillJson(route, 200, { model: updatedModel });
}

async function handleAiCapabilityRoute(route: Route, state: MockAiApiState): Promise<void> {
  if (route.request().method() !== "GET") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const capability = decodeURIComponent(
    new URL(route.request().url()).pathname.split("/").pop() ?? ""
  ) as AiModelCapability;
  const manualModelId = state.aiCapabilityRoutes?.[capability] ?? null;
  const manualModel = manualModelId
    ? findCompatibleModel(state, capability, manualModelId)
    : undefined;
  if (manualModel) {
    return fulfillJson(route, 200, {
      route: {
        capability,
        available: true,
        reason: "manual-route",
        model: manualModel
      }
    });
  }
  const model =
    (state.aiModels ?? []).find((item) => findCompatibleModel(state, capability, item.id)) ?? null;

  return fulfillJson(route, 200, {
    route: {
      capability,
      available: Boolean(model),
      reason: manualModelId
        ? "manual-route-unavailable-fallback"
        : model
          ? "matched-active-model"
          : "no-active-model",
      model
    }
  });
}

async function handleAiCapabilityRoutes(route: Route, state: MockAiApiState): Promise<void> {
  if (route.request().method() !== "GET") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  return fulfillJson(route, 200, { routes: state.aiCapabilityRoutes ?? {} });
}

async function handleAiCapabilityRouteDetail(route: Route, state: MockAiApiState): Promise<void> {
  const request = route.request();
  if (request.method() !== "PUT") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const capability = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
  const input = request.postDataJSON() as PutAiCapabilityRouteRequest;
  state.aiCapabilityRoutes = {
    ...(state.aiCapabilityRoutes ?? {}),
    [capability]: input.modelId
  };

  return fulfillJson(route, 200, { route: { capability, modelId: input.modelId } });
}

async function handleAiCapabilityTierPreferences(
  route: Route,
  state: MockAiApiState
): Promise<void> {
  const request = route.request();

  if (request.method() === "GET") {
    return fulfillJson(route, 200, { preferences: state.aiCapabilityRoutes ?? {} });
  }

  if (request.method() === "PATCH") {
    return fulfillJson(route, 204, {});
  }

  return fulfillJson(route, 405, { error: "Method not allowed" });
}

function findCompatibleModel(
  state: MockAiApiState,
  capability: AiModelCapability,
  modelId: string
): AiConfiguredModelDto | undefined {
  return (state.aiModels ?? []).find((item) => {
    const provider = (state.aiProviders ?? []).find(
      (providerConfig) => providerConfig.id === item.providerConfigId
    );

    return (
      item.id === modelId &&
      item.status === "active" &&
      item.capabilities.includes(capability) &&
      provider?.status === "active"
    );
  });
}

export function createMockAiProvider(
  id: string,
  overrides: Partial<AiProviderConfigDto> = {}
): AiProviderConfigDto {
  return {
    id,
    providerKind: "openai-compatible",
    displayName: "OpenAI Compatible",
    baseUrl: null,
    status: "active",
    authMethod: "api_key",
    hasCredential: true,
    cliAvailable: false,
    revokedAt: null,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

export function createMockAiModel(
  id: string,
  overrides: Partial<AiConfiguredModelDto> = {}
): AiConfiguredModelDto {
  return {
    id,
    providerConfigId: "ai-provider-1",
    providerKind: "openai-compatible",
    providerDisplayName: "OpenAI Compatible",
    providerStatus: "active",
    providerModelId: "model-id",
    displayName: "Model",
    capabilities: ["chat"],
    status: "active",
    tier: "interactive",
    allowUserOverride: true,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

export function createMockAiAssistantTools(): AiAssistantToolDto[] {
  return [
    {
      moduleId: "tasks",
      moduleName: "Tasks",
      name: "tasks.listVisible",
      description: "List visible tasks.",
      permissionId: "tasks.view",
      risk: "read",
      inputSchema: {
        type: "object"
      },
      outputSchema: null
    },
    {
      moduleId: "tasks",
      moduleName: "Tasks",
      name: "tasks.updateStatus",
      description: "Queue a task status update.",
      permissionId: "tasks.update",
      risk: "write",
      inputSchema: {
        type: "object"
      },
      outputSchema: null
    }
  ];
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
