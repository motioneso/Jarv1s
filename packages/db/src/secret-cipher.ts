import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { type Keyring } from "./keyring.js";

/**
 * AES-256-GCM JSON secret envelope. Domain modules re-export this under a
 * named alias (e.g. `EncryptedAiSecret`, `EncryptedConnectorSecret`) for
 * readability — the on-disk shape is identical across all secret domains.
 */
export interface EncryptedSecret extends Record<string, unknown> {
  readonly version: 1;
  readonly algorithm: "aes-256-gcm";
  readonly keyId?: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

/**
 * Generic authenticated-encryption cipher for at-rest JSON secrets, backed by
 * a rotating {@link Keyring}. A single implementation serves every secret
 * domain (AI credentials, connector credentials, ...); the `label` only names
 * the domain in error messages — it never affects the ciphertext.
 *
 * Mid-sentence messages use `label` verbatim ("AI secret", "connector secret");
 * the sentence-leading payload message capitalizes its first letter. This
 * reproduces the historical per-module strings exactly.
 */
export class JsonSecretCipher {
  private readonly capitalizedLabel: string;

  constructor(
    private readonly keyring: Keyring,
    private readonly label: string
  ) {
    this.capitalizedLabel = label.charAt(0).toUpperCase() + label.slice(1);
  }

  encryptJson(value: Record<string, unknown>): EncryptedSecret {
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

  decryptJson(envelope: EncryptedSecret): Record<string, unknown> {
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
      throw new Error(`Unsupported ${this.label} envelope`);
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
        throw new Error(`Legacy ${this.label} envelope: no key could authenticate it`);
      }
      rawPlaintext = decrypted;
    } else {
      const key = this.keyring.keys.get(envelope.keyId);
      if (!key) throw new Error(`Unknown ${this.label} key id: ${envelope.keyId}`);
      rawPlaintext = tryKey(key);
    }

    const parsed = JSON.parse(rawPlaintext.toString("utf8")) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${this.capitalizedLabel} payload must be a JSON object`);
    }

    return parsed as Record<string, unknown>;
  }
}
