import { describe, expect, it } from "vitest";

import { createModuleCredentialSecretCipher } from "../../packages/settings/src/module-credential-crypto.js";

describe("module credential cipher", () => {
  it("round-trips a value without the envelope containing plaintext", () => {
    const cipher = createModuleCredentialSecretCipher({});
    const envelope = cipher.encryptJson({ value: "super-secret-plaintext-123" });
    expect(envelope.version).toBe(1);
    expect(envelope.algorithm).toBe("aes-256-gcm");
    expect(JSON.stringify(envelope)).not.toContain("super-secret-plaintext-123");
    expect(cipher.decryptJson(envelope)).toEqual({ value: "super-secret-plaintext-123" });
  });
});
