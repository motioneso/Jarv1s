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

export const RUNTIME_CONFIG_REGISTRY: readonly RuntimeConfigKeyEntry[] = [
  {
    key: EMBED_PROVIDER_CONFIG_KEY,
    label: "Embedding provider",
    type: "enum",
    description:
      "Where notes/knowledge embeddings are generated. 'local' = on-device model; 'stub' = no-op (search won't work).",
    defaultValue: "local",
    envVar: "JARVIS_EMBED_PROVIDER",
    enumValues: ["local", "stub"],
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
  }
] as const;

const RUNTIME_CONFIG_BY_KEY = new Map(RUNTIME_CONFIG_REGISTRY.map((entry) => [entry.key, entry]));

export function getRuntimeConfigEntry(key: string): RuntimeConfigKeyEntry | undefined {
  return RUNTIME_CONFIG_BY_KEY.get(key);
}
