import { JsonSecretCipher, resolveKeyring, type EncryptedSecret, type Keyring } from "@jarv1s/db";

/**
 * AES-256-GCM envelope for connector credentials. Shape alias of the shared
 * {@link EncryptedSecret} — kept as a named type for readability at call sites.
 */
export type EncryptedConnectorSecret = EncryptedSecret;

/** {@link JsonSecretCipher} bound to the "connector secret" domain label. */
export class ConnectorSecretCipher extends JsonSecretCipher {
  constructor(keyring: Keyring) {
    super(keyring, "connector secret");
  }
}

export function createConnectorSecretCipher(
  env: NodeJS.ProcessEnv = process.env
): ConnectorSecretCipher {
  return new ConnectorSecretCipher(
    resolveKeyring(
      "JARVIS_CONNECTOR_SECRET_KEY",
      "JARVIS_CONNECTOR_SECRET_KEY_ID",
      "JARVIS_CONNECTOR_SECRET_KEYS",
      "jarv1s-development-connector-secret",
      env
    )
  );
}
