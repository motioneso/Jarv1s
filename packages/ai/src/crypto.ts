import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedAiSecret extends Record<string, unknown> {
  readonly version: 1;
  readonly algorithm: "aes-256-gcm";
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export class AiSecretCipher {
  constructor(private readonly key: Buffer) {}

  encryptJson(value: Record<string, unknown>): EncryptedAiSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    return {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
  }

  decryptJson(envelope: EncryptedAiSecret): Record<string, unknown> {
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
      throw new Error("Unsupported AI secret envelope");
    }

    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("AI secret payload must be a JSON object");
    }

    return parsed as Record<string, unknown>;
  }
}

export function createAiSecretCipher(env: NodeJS.ProcessEnv = process.env): AiSecretCipher {
  return new AiSecretCipher(resolveAiSecretKey(env));
}

function resolveAiSecretKey(env: NodeJS.ProcessEnv): Buffer {
  const configuredSecret = env.JARVIS_AI_SECRET_KEY;

  if (configuredSecret) {
    return createHash("sha256").update(configuredSecret).digest();
  }

  if (env.NODE_ENV === "production") {
    throw new Error("JARVIS_AI_SECRET_KEY is required in production");
  }

  return createHash("sha256").update("jarv1s-development-ai-secret").digest();
}
