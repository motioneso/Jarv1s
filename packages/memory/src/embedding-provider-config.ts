import type { EmbeddingProvider } from "./embedding-provider.js";
import { StubEmbeddingProvider } from "./embedding-provider.js";
import { LocalEmbeddingProvider } from "./local-embedding-provider.js";

export type EmbeddingProviderKind = "local" | "stub";

export interface EmbeddingProviderConfig {
  readonly kind: EmbeddingProviderKind;
  readonly modelId?: string;
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

/**
 * Read instance-level embedding config from the environment.
 * M-A3 replaces this with a DB-backed reader feeding the capability router; the
 * EmbeddingProviderConfig shape and createEmbeddingProvider factory stay stable.
 */
export function getEmbeddingProviderConfig(): EmbeddingProviderConfig {
  const kind = (process.env["JARVIS_EMBED_PROVIDER"] ?? "local") as EmbeddingProviderKind;
  const modelId = process.env["JARVIS_EMBED_MODEL"];
  return modelId ? { kind, modelId } : { kind };
}
