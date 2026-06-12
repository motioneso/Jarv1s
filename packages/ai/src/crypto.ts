import { JsonSecretCipher, resolveKeyring, type EncryptedSecret, type Keyring } from "@jarv1s/db";

/**
 * AES-256-GCM envelope for AI provider credentials. Shape alias of the shared
 * {@link EncryptedSecret} — kept as a named type for readability at call sites.
 */
export type EncryptedAiSecret = EncryptedSecret;

/** {@link JsonSecretCipher} bound to the "AI secret" domain label. */
export class AiSecretCipher extends JsonSecretCipher {
  constructor(keyring: Keyring) {
    super(keyring, "AI secret");
  }
}

export function createAiSecretCipher(env: NodeJS.ProcessEnv = process.env): AiSecretCipher {
  return new AiSecretCipher(
    resolveKeyring(
      "JARVIS_AI_SECRET_KEY",
      "JARVIS_AI_SECRET_KEY_ID",
      "JARVIS_AI_SECRET_KEYS",
      "jarv1s-development-ai-secret",
      env
    )
  );
}
