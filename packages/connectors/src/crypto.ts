import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { type Keyring, resolveKeyring } from "@jarv1s/db";

export interface EncryptedConnectorSecret extends Record<string, unknown> {
  readonly version: 1;
  readonly algorithm: "aes-256-gcm";
  readonly keyId?: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export class ConnectorSecretCipher {
  constructor(private readonly keyring: Keyring) {}

  encryptJson(value: Record<string, unknown>): EncryptedConnectorSecret {
    const key = this.keyring.keys.get(this.keyring.currentKeyId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    return {
      version: 1,
      algorithm: "aes-256-gcm",
      keyId: this.keyring.currentKeyId,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
  }

  decryptJson(envelope: EncryptedConnectorSecret): Record<string, unknown> {
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
      throw new Error("Unsupported connector secret envelope");
    }

    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");

    const tryKey = (key: Buffer): Buffer => {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    };

    let rawPlaintext: Buffer;

    if (envelope.keyId === undefined) {
      // Legacy envelope: try current key first, then retired keys in order.
      let decrypted: Buffer | undefined;
      for (const candidate of this.keyring.legacyCandidates) {
        try {
          decrypted = tryKey(candidate);
          break;
        } catch {
          // auth tag mismatch — try next candidate
        }
      }
      if (!decrypted) {
        throw new Error("Legacy connector secret envelope: no key could authenticate it");
      }
      rawPlaintext = decrypted;
    } else {
      const key = this.keyring.keys.get(envelope.keyId);
      if (!key) throw new Error(`Unknown connector secret key id: ${envelope.keyId}`);
      rawPlaintext = tryKey(key);
    }

    const parsed = JSON.parse(rawPlaintext.toString("utf8")) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Connector secret payload must be a JSON object");
    }

    return parsed as Record<string, unknown>;
  }
}

export function createConnectorSecretCipher(env: NodeJS.ProcessEnv = process.env) {
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
