import { createHash } from "node:crypto";

export interface Keyring {
  readonly currentKeyId: string;
  readonly keys: Map<string, Buffer>;
  /** Keys to try in order when decrypting a legacy (no-keyId) envelope.
   * Current key is always first; retired keys follow. */
  readonly legacyCandidates: readonly Buffer[];
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
  const retiredBuffers: Buffer[] = [];

  if (keysJson) {
    const parsed = JSON.parse(keysJson) as Record<string, string>;

    for (const [id, secret] of Object.entries(parsed)) {
      const buf = createHash("sha256").update(secret).digest();
      keys.set(id, buf);
      retiredBuffers.push(buf);
    }
  }

  // Envelopes written before keyId was introduced carry no keyId field.
  // Try the current key first (not-yet-rotated deployments), then each retired
  // key (post-rotation deployments where the legacy envelope predates rotation).
  const legacyCandidates: readonly Buffer[] = [currentKeyBuffer, ...retiredBuffers];

  return { currentKeyId, keys, legacyCandidates };
}
