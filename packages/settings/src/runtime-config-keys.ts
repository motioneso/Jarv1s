export type RuntimeConfigType = "string" | "enum" | "int" | "secret";

export interface RuntimeConfigKeyEntry {
  readonly key: string;
  readonly label: string;
  readonly type: RuntimeConfigType;
  readonly description: string;
  readonly defaultValue: string;
  readonly envVar: string;
  readonly enumValues?: readonly string[];
  readonly secret?: boolean;
  readonly moduleOwner: string;
}

export const EMBED_PROVIDER_CONFIG_KEY = "ai.embed_provider";
export const EMBED_MODEL_CONFIG_KEY = "ai.embed_model";
export const BRAVE_API_KEY_CONFIG_KEY = "ai.brave_api_key";

export const RUNTIME_CONFIG_REGISTRY: readonly RuntimeConfigKeyEntry[] = [
  {
    key: EMBED_PROVIDER_CONFIG_KEY,
    label: "Embedding provider",
    type: "enum",
    // #1313: "stub" (a SHA-256-stretched fake vector, test-only — see
    // packages/memory/src/embedding-provider.ts) is deliberately NOT listed here. This list
    // feeds both the admin/self-operation PATCH write-validation
    // (runtime-config-routes.ts's validateRuntimeValue) and the description shown to
    // operators — a real instance must never be steered onto the fake provider, which makes
    // semantic search silently return noise while the instance looks healthy. Test/CI/UAT
    // harnesses still reach the stub provider through an explicit escape hatch
    // (NODE_ENV=test or JARVIS_ALLOW_STUB_EMBEDDINGS=1), enforced in
    // packages/memory/src/embedding-provider-config.ts, never through this enum.
    description: "Where notes/knowledge embeddings are generated. 'local' = on-device model.",
    defaultValue: "local",
    envVar: "JARVIS_EMBED_PROVIDER",
    enumValues: ["local"],
    moduleOwner: "memory"
  },
  {
    key: EMBED_MODEL_CONFIG_KEY,
    label: "Embedding model",
    type: "string",
    description: "Model id for the local embedding provider. Leave blank for the provider default.",
    defaultValue: "",
    envVar: "JARVIS_EMBED_MODEL",
    moduleOwner: "memory"
  },
  {
    key: BRAVE_API_KEY_CONFIG_KEY,
    label: "Brave Search API key",
    type: "secret",
    description: "API key for Brave Search. Leave blank to disable web search.",
    defaultValue: "",
    envVar: "JARVIS_BRAVE_API_KEY",
    secret: true,
    moduleOwner: "ai"
  }
] as const;

const RUNTIME_CONFIG_BY_KEY = new Map(RUNTIME_CONFIG_REGISTRY.map((entry) => [entry.key, entry]));

export function getRuntimeConfigEntry(key: string): RuntimeConfigKeyEntry | undefined {
  return RUNTIME_CONFIG_BY_KEY.get(key);
}
