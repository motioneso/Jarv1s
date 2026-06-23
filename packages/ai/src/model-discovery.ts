import type { AiModelCapability, AiModelTier, AiProviderDiscoveredModelDto } from "@jarv1s/shared";
import type { AiAuthMethod, AiProviderKind } from "@jarv1s/db";

const CACHE_TTL_MS = 3_600_000; // 1 hour

interface CacheEntry {
  readonly models: AiProviderDiscoveredModelDto[];
  readonly fromFallback: boolean;
  readonly expiresAt: number;
}

// Static fallback — no hardcoded model IDs outside this file.
const ANTHROPIC_STATIC_MODELS: readonly AiProviderDiscoveredModelDto[] = [
  {
    providerModelId: "claude-opus-4-8",
    displayName: "Claude Opus 4.8",
    capabilities: ["chat", "tool-use", "json", "vision", "summarization"],
    tier: "reasoning"
  },
  {
    providerModelId: "claude-sonnet-4-6",
    displayName: "Claude",
    capabilities: ["chat", "tool-use", "json", "vision", "summarization"],
    tier: "interactive"
  },
  {
    providerModelId: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    capabilities: ["chat", "tool-use", "json", "summarization"],
    tier: "economy"
  }
];

export interface ModelDiscoveryInput {
  readonly providerKind: AiProviderKind;
  readonly authMethod: AiAuthMethod;
  readonly baseUrl: string | null;
  readonly credential: unknown;
  readonly fetch?: typeof globalThis.fetch;
}

export interface DiscoverModelsResult {
  readonly models: AiProviderDiscoveredModelDto[];
  readonly fromCache: boolean;
  readonly fromFallback: boolean;
  readonly cacheExpiresAt: number | null;
}

export class ModelDiscoveryService {
  private readonly cache = new Map<string, CacheEntry>();

  async discoverModels(
    cacheKey: string,
    input: ModelDiscoveryInput
  ): Promise<DiscoverModelsResult> {
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return {
        models: cached.models,
        fromCache: true,
        fromFallback: cached.fromFallback,
        cacheExpiresAt: cached.expiresAt
      };
    }

    const { models, fromFallback } = await fetchModels(input);
    if (!fromFallback) {
      this.cache.set(cacheKey, { models, fromFallback, expiresAt: now + CACHE_TTL_MS });
    }
    return {
      models,
      fromCache: false,
      fromFallback,
      cacheExpiresAt: fromFallback ? null : now + CACHE_TTL_MS
    };
  }

  invalidate(actorUserId: string, providerId: string): void {
    this.cache.delete(`${actorUserId}:${providerId}`);
  }
}

async function fetchModels(
  input: ModelDiscoveryInput
): Promise<{ models: AiProviderDiscoveredModelDto[]; fromFallback: boolean }> {
  if (input.authMethod === "cli") return { models: [], fromFallback: false };

  const apiKey = readApiKey(input.credential);
  if (!apiKey) {
    return input.providerKind === "anthropic"
      ? { models: ANTHROPIC_STATIC_MODELS.slice(), fromFallback: true }
      : { models: [], fromFallback: false };
  }

  try {
    const response = await doFetch(input, apiKey);
    if (!response.ok) {
      return input.providerKind === "anthropic"
        ? { models: ANTHROPIC_STATIC_MODELS.slice(), fromFallback: true }
        : { models: [], fromFallback: false };
    }
    const models = extractModelIds(input.providerKind, await response.json()).map((id) =>
      inferModel(id, input.providerKind)
    );
    return { models, fromFallback: false };
  } catch {
    return input.providerKind === "anthropic"
      ? { models: ANTHROPIC_STATIC_MODELS.slice(), fromFallback: true }
      : { models: [], fromFallback: false };
  }
}

function readApiKey(credential: unknown): string | null {
  if (!credential || typeof credential !== "object") return null;
  const value = (credential as { apiKey?: unknown }).apiKey;
  return typeof value === "string" && value.trim() ? value : null;
}

function doFetch(input: ModelDiscoveryInput, apiKey: string): Promise<Response> {
  const f = input.fetch ?? globalThis.fetch;
  switch (input.providerKind) {
    case "anthropic":
      return f("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      });
    case "google":
      return f("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": apiKey }
      });
    case "openai-compatible":
    case "ollama":
    case "custom": {
      const base = (input.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "");
      return f(`${base}/v1/models`, { headers: { authorization: `Bearer ${apiKey}` } });
    }
  }
}

function extractModelIds(providerKind: AiProviderKind, json: unknown): string[] {
  if (!json || typeof json !== "object") return [];

  const data = (json as { data?: unknown }).data;
  if (Array.isArray(data)) {
    let ids = data
      .map((item) => (item && typeof item === "object" ? (item as { id?: unknown }).id : null))
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (providerKind === "anthropic") {
      // Include only current claude- models; exclude legacy snapshot versions (contain ":")
      ids = ids.filter((id) => id.includes("claude-") && !id.includes(":"));
    }
    return ids;
  }

  const models = (json as { models?: unknown }).models;
  if (Array.isArray(models)) {
    return models
      .map((item) =>
        item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"
          ? (item as { name: string }).name.replace(/^models\//, "")
          : null
      )
      .filter((id): id is string => Boolean(id));
  }
  return [];
}

export function inferTierFromModelId(providerKind: AiProviderKind, modelId: string): AiModelTier {
  const id = modelId.toLowerCase();
  if (providerKind === "anthropic") {
    if (id.includes("opus")) return "reasoning";
    if (id.includes("sonnet")) return "interactive";
    if (id.includes("haiku")) return "economy";
    return "interactive";
  }
  if (providerKind === "openai-compatible") {
    if (/\bo[0-9]/.test(id)) return "reasoning";
    if (id.includes("mini") || id.includes("nano") || id.includes("small")) return "economy";
    if (id.includes("3.5") || id.includes("3-5")) return "economy";
    return "interactive";
  }
  // google, ollama, custom: use name hints
  if (id.includes("mini") || id.includes("flash") || id.includes("haiku")) return "economy";
  if (id.includes("opus") || id.includes("reason")) return "reasoning";
  return "interactive";
}

function inferModel(
  providerModelId: string,
  providerKind: AiProviderKind
): AiProviderDiscoveredModelDto {
  const lower = providerModelId.toLowerCase();
  const capabilities: AiModelCapability[] = ["chat", "tool-use", "json", "summarization"];
  if (lower.includes("vision") || lower.includes("image") || lower.includes("gemini")) {
    capabilities.push("vision");
  }
  const tier = inferTierFromModelId(providerKind, providerModelId);
  return { providerModelId, displayName: providerModelId, capabilities, tier };
}
