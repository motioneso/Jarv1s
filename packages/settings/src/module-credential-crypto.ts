import { JsonSecretCipher, resolveKeyring, type EncryptedSecret, type Keyring } from "@jarv1s/db";

/**
 * AES-256-GCM envelope stored in app.module_credentials.encrypted_secret (#918).
 * NOTE: Slice 2 has ZERO production decrypt call sites — the only consumer of
 * stored module credentials is Slice 3's worker RPC (ctx.auth.getCredential).
 * decryptJson exists on the base class and is exercised only by unit tests.
 */
export type EncryptedModuleCredentialSecret = EncryptedSecret;

/** {@link JsonSecretCipher} bound to the "module credential secret" domain label. */
export class ModuleCredentialCipher extends JsonSecretCipher {
  constructor(keyring: Keyring) {
    super(keyring, "module credential secret");
  }
}

/**
 * Dedicated key family so module-credential keys rotate independently of
 * connector/AI keys. Hardened env requires a >=32-byte secret via
 * JARVIS_MODULE_CREDENTIAL_SECRET_KEY (resolveKeyring enforces this); the dev
 * default is only ever used outside hardened mode.
 */
export function createModuleCredentialSecretCipher(
  env: NodeJS.ProcessEnv = process.env
): ModuleCredentialCipher {
  return new ModuleCredentialCipher(
    resolveKeyring(
      "JARVIS_MODULE_CREDENTIAL_SECRET_KEY",
      "JARVIS_MODULE_CREDENTIAL_SECRET_KEY_ID",
      "JARVIS_MODULE_CREDENTIAL_SECRET_KEYS",
      "jarv1s-development-module-credential-secret",
      env
    )
  );
}
