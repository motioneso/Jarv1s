export interface InstanceSettingKeyEntry {
  readonly key: string;
  readonly secret?: boolean;
}

export const INSTANCE_SETTINGS_REGISTRY: readonly InstanceSettingKeyEntry[] = [
  { key: "registration.enabled" },
  { key: "registration.requires_approval" },
  { key: "chat.multiplexer" },
  { key: "onboarding.state" },
  { key: "ai.chat_model_override.enabled" }
] as const;

export const KNOWN_INSTANCE_SETTING_KEYS: ReadonlySet<string> = new Set(
  INSTANCE_SETTINGS_REGISTRY.map((e) => e.key)
);
