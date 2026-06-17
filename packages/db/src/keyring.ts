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
 * - Legacy (absent-keyId) envelopes: decrypted by trying `legacyCandidates`
 *   in order (current key first, then retired keys).
 */
export function resolveKeyring(
  keyEnvVar: string,
  keyIdEnvVar: string,
  keysEnvVar: string,
  devDefault: string,
  env: NodeJS.ProcessEnv = process.env
): Keyring {
  const currentSecret = env[keyEnvVar];

  // "Hardened" = an explicitly-named environment that is not development or test.
  // Unset NODE_ENV stays permissive so local dev (`tsx watch`, no NODE_ENV) and the
  // compose smoke harness keep using the dev default; production sets NODE_ENV=production
  // (infra/env.production.example), so it — and any staging/preview env — is hardened.
  const nodeEnv = env.NODE_ENV;
  const isHardenedEnv = nodeEnv !== undefined && nodeEnv !== "development" && nodeEnv !== "test";

  if (!currentSecret && isHardenedEnv) {
    // Substring "is required in production" is asserted by tests — keep it stable.
    throw new Error(
      `${keyEnvVar} is required in production (and any non-development/test NODE_ENV)`
    );
  }

  // SHA-256 is a sound KDF for a high-entropy key but trivially brute-forced for a
  // short human passphrase. In a hardened env, reject anything below 32 bytes of key
  // material so the at-rest AES key always derives from real entropy (#114). The dev
  // default is exempt: it only ever guards throwaway data in development/test.
  if (
    currentSecret !== undefined &&
    isHardenedEnv &&
    Buffer.byteLength(currentSecret, "utf8") < 32
  ) {
    throw new Error(
      `${keyEnvVar} must be at least 32 bytes of key material in production (and any non-development/test NODE_ENV)`
    );
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
    const parsed: unknown = JSON.parse(keysJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${keysEnvVar} must be a JSON object of {keyId: secret}`);
    }

    for (const [id, secret] of Object.entries(parsed)) {
      // A non-string/empty secret here would silently derive a key from "undefined"
      // or "", quietly weakening rotation — reject it at load time (#114).
      if (typeof secret !== "string" || secret === "") {
        throw new Error(`${keysEnvVar} entry "${id}" must be a non-empty string secret`);
      }
      if (id === currentKeyId) {
        continue;
      }
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
