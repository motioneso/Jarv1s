import { createHash } from "node:crypto";

export interface Keyring {
  readonly currentKeyId: string;
  readonly keys: Map<string, Buffer>;
}

/**
 * Resolves a cipher keyring from environment variables.
 *
 * - Current key: derived from `keyEnvVar` (or `devDefault` in non-production).
 * - Current key id: `keyIdEnvVar` (default "v1").
 * - Additional keys: `keysEnvVar` JSON object {"id":"secret",...}.
 * - Legacy (absent-keyId) envelopes: mapped to reserved id "legacy", which
 *   falls back to the current key if no separate legacy key is configured.
 */
export function resolveKeyring(
  keyEnvVar: string,
  keyIdEnvVar: string,
  keysEnvVar: string,
  devDefault: string,
  env: NodeJS.ProcessEnv = process.env
): Keyring {
  const currentSecret = env[keyEnvVar];

  if (!currentSecret && env.NODE_ENV === "production") {
    throw new Error(`${keyEnvVar} is required in production`);
  }

  const rawCurrentSecret = currentSecret ?? devDefault;
  const currentKeyBuffer = createHash("sha256").update(rawCurrentSecret).digest();
  const currentKeyId = env[keyIdEnvVar] ?? "v1";

  const keys = new Map<string, Buffer>();
  keys.set(currentKeyId, currentKeyBuffer);

  // Parse additional/retired keys from JSON {"id":"secret",...}
  const keysJson = env[keysEnvVar];

  if (keysJson) {
    const parsed = JSON.parse(keysJson) as Record<string, string>;

    for (const [id, secret] of Object.entries(parsed)) {
      keys.set(id, createHash("sha256").update(secret).digest());
    }
  }

  // Envelopes written before keyId was introduced have no keyId field.
  // Map the reserved "legacy" id to the current key so they continue to decrypt.
  if (!keys.has("legacy")) {
    keys.set("legacy", currentKeyBuffer);
  }

  return { currentKeyId, keys };
}
