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
const EMBEDDING_PROVIDER_KINDS: readonly EmbeddingProviderKind[] = ["local", "stub"];

export function getEmbeddingProviderConfig(): EmbeddingProviderConfig {
  const raw = process.env["JARVIS_EMBED_PROVIDER"] ?? "local";
  // Validate at the boundary rather than casting an arbitrary env string to the
  // union: an operator typo (`JARVIS_EMBED_PROVIDER=stb`) would otherwise flow
  // through the factory and only fail later — or worse, silently mis-route once a
  // third provider kind exists (#146).
  if (!EMBEDDING_PROVIDER_KINDS.includes(raw as EmbeddingProviderKind)) {
    throw new Error(
      `Invalid JARVIS_EMBED_PROVIDER "${raw}" (expected one of: ${EMBEDDING_PROVIDER_KINDS.join(", ")})`
    );
  }
  const kind = raw as EmbeddingProviderKind;
  const modelId = process.env["JARVIS_EMBED_MODEL"];
  return modelId ? { kind, modelId } : { kind };
}
