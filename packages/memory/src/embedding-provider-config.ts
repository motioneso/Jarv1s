import type { EmbeddingProvider } from "./embedding-provider.js";
import { StubEmbeddingProvider } from "./embedding-provider.js";
import { LocalEmbeddingProvider } from "./local-embedding-provider.js";

export type EmbeddingProviderKind = "local" | "stub";

export interface EmbeddingProviderConfig {
  readonly kind: EmbeddingProviderKind;
  readonly modelId?: string;
}

export interface EmbeddingRuntimeConfigResolver {
  resolveEnum(key: "ai.embed_provider"): Promise<EmbeddingProviderKind>;
  resolveString(key: "ai.embed_model"): Promise<string>;
}

/** The only place that instantiates an embedding provider. Never hardcode a provider elsewhere. */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.kind) {
    case "local":
      return new LocalEmbeddingProvider(config.modelId);
    case "stub":
      return new StubEmbeddingProvider();
  }
}

export async function getEmbeddingProviderConfig(
  resolver: EmbeddingRuntimeConfigResolver
): Promise<EmbeddingProviderConfig> {
  const kind = await resolver.resolveEnum("ai.embed_provider");
  const modelId = await resolver.resolveString("ai.embed_model");
  return modelId ? { kind, modelId } : { kind };
}
