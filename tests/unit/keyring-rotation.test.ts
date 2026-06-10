/**
 * Regression test for #73 (CRITICAL C2): legacy-envelope decryption must survive key rotation.
 *
 * Gap the prior test suite had: legacy-decrypt and rotation were tested separately.
 * This file tests the COMBINATION — the exact scenario that was broken on origin/main.
 *
 * Failure matrix (to verify before merging):
 *   test (a) — should PASS on origin/main AND with fix (no regression)
 *   test (b) — should FAIL on origin/main, PASS with fix
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { AiSecretCipher } from "@jarv1s/ai";
import { ConnectorSecretCipher } from "@jarv1s/connectors";
import { resolveKeyring, type Keyring } from "@jarv1s/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKeyBuffer(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** Build a test env object for resolveKeyring. */
function makeEnv(opts: {
  currentSecret: string;
  currentKeyId?: string;
  retiredSecrets?: Record<string, string>;
}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    JARVIS_AI_SECRET_KEY: opts.currentSecret,
    JARVIS_AI_SECRET_KEY_ID: opts.currentKeyId ?? "v1",
    JARVIS_CONNECTOR_SECRET_KEY: opts.currentSecret,
    JARVIS_CONNECTOR_SECRET_KEY_ID: opts.currentKeyId ?? "v1"
  };
  if (opts.retiredSecrets && Object.keys(opts.retiredSecrets).length > 0) {
    const json = JSON.stringify(opts.retiredSecrets);
    env.JARVIS_AI_SECRET_KEYS = json;
    env.JARVIS_CONNECTOR_SECRET_KEYS = json;
  }
  return env as NodeJS.ProcessEnv;
}

function makeAiCipher(env: NodeJS.ProcessEnv): AiSecretCipher {
  return new AiSecretCipher(
    resolveKeyring(
      "JARVIS_AI_SECRET_KEY",
      "JARVIS_AI_SECRET_KEY_ID",
      "JARVIS_AI_SECRET_KEYS",
      "unused-dev-default",
      env
    )
  );
}

function makeConnectorCipher(env: NodeJS.ProcessEnv): ConnectorSecretCipher {
  return new ConnectorSecretCipher(
    resolveKeyring(
      "JARVIS_CONNECTOR_SECRET_KEY",
      "JARVIS_CONNECTOR_SECRET_KEY_ID",
      "JARVIS_CONNECTOR_SECRET_KEYS",
      "unused-dev-default",
      env
    )
  );
}

/** Produce a legacy-style (no keyId) version of a normal encrypted envelope. */
function stripKeyId<T extends { keyId?: string }>(
  envelope: T
): Omit<T, "keyId"> & { keyId: undefined } {
  return { ...envelope, keyId: undefined };
}

// ---------------------------------------------------------------------------
// (a) No-rotation path — legacy envelope decrypts with single key (no JARVIS_*_SECRET_KEYS)
//     MUST pass on origin/main AND with this fix (no regression allowed)
// ---------------------------------------------------------------------------

describe("(a) legacy envelope — no-rotation deployment (single key)", () => {
  const payload = { kind: "test", token: "abc123" };

  it("AiSecretCipher: legacy envelope decrypts when only current key exists", () => {
    const env = makeEnv({ currentSecret: "my-only-secret", currentKeyId: "v1" });
    const cipher = makeAiCipher(env);

    const normal = cipher.encryptJson(payload);
    const legacy = stripKeyId(normal);
    expect(legacy.keyId).toBeUndefined();

    const result = cipher.decryptJson(legacy);
    expect(result.token).toBe("abc123");
  });

  it("ConnectorSecretCipher: legacy envelope decrypts when only current key exists", () => {
    const env = makeEnv({ currentSecret: "my-only-secret", currentKeyId: "v1" });
    const cipher = makeConnectorCipher(env);

    const normal = cipher.encryptJson(payload);
    const legacy = stripKeyId(normal);
    expect(legacy.keyId).toBeUndefined();

    const result = cipher.decryptJson(legacy);
    expect(result.token).toBe("abc123");
  });
});

// ---------------------------------------------------------------------------
// (b) Post-rotation path — legacy envelope must still decrypt after rotation
//     FAILS on origin/main (legacy→currentKey bricks the envelope), PASSES with fix
// ---------------------------------------------------------------------------

describe("(b) legacy envelope — post-rotation deployment", () => {
  const payload = { kind: "test", accessToken: "secret-token-xyz" };
  const oldSecret = "old-key-secret";
  const newSecret = "new-key-secret-after-rotation";

  it("AiSecretCipher: legacy envelope (encrypted pre-rotation) decrypts after rotation", () => {
    // Step 1: encrypt with the OLD keyring (pre-rotation, no retired keys)
    const preRotationEnv = makeEnv({ currentSecret: oldSecret, currentKeyId: "v1" });
    const preRotationCipher = makeAiCipher(preRotationEnv);
    const normalEnvelope = preRotationCipher.encryptJson(payload);

    // Step 2: create a legacy-style envelope (strip keyId, as-if written before keyId field existed)
    const legacyEnvelope = stripKeyId(normalEnvelope);
    expect(legacyEnvelope.keyId).toBeUndefined();

    // Step 3: build the rotated keyring (new current key, old key in retired map)
    const postRotationEnv = makeEnv({
      currentSecret: newSecret,
      currentKeyId: "v2",
      retiredSecrets: { v1: oldSecret }
    });
    const postRotationCipher = makeAiCipher(postRotationEnv);

    // Step 4: decrypt the legacy envelope with the rotated cipher — must succeed
    const result = postRotationCipher.decryptJson(legacyEnvelope);
    expect(result.accessToken).toBe("secret-token-xyz");
  });

  it("ConnectorSecretCipher: legacy envelope (encrypted pre-rotation) decrypts after rotation", () => {
    const preRotationEnv = makeEnv({ currentSecret: oldSecret, currentKeyId: "v1" });
    const preRotationCipher = makeConnectorCipher(preRotationEnv);
    const normalEnvelope = preRotationCipher.encryptJson(payload);

    const legacyEnvelope = stripKeyId(normalEnvelope);
    expect(legacyEnvelope.keyId).toBeUndefined();

    const postRotationEnv = makeEnv({
      currentSecret: newSecret,
      currentKeyId: "v2",
      retiredSecrets: { v1: oldSecret }
    });
    const postRotationCipher = makeConnectorCipher(postRotationEnv);

    const result = postRotationCipher.decryptJson(legacyEnvelope);
    expect(result.accessToken).toBe("secret-token-xyz");
  });

  it("AiSecretCipher: force-rewrap of legacy envelope produces current-keyId envelope", () => {
    const preRotationEnv = makeEnv({ currentSecret: oldSecret, currentKeyId: "v1" });
    const preRotationCipher = makeAiCipher(preRotationEnv);
    const legacyEnvelope = stripKeyId(preRotationCipher.encryptJson(payload));

    const postRotationEnv = makeEnv({
      currentSecret: newSecret,
      currentKeyId: "v2",
      retiredSecrets: { v1: oldSecret }
    });
    const postRotationCipher = makeAiCipher(postRotationEnv);

    // Rewrap: decrypt legacy → re-encrypt with new current key
    const plaintext = postRotationCipher.decryptJson(legacyEnvelope);
    const rewrapped = postRotationCipher.encryptJson(plaintext);

    // Rewrapped envelope must carry the new keyId and decrypt cleanly
    expect(rewrapped.keyId).toBe("v2");
    const roundTrip = postRotationCipher.decryptJson(rewrapped);
    expect(roundTrip.accessToken).toBe("secret-token-xyz");
  });

  it("throws a named error when no retired key can authenticate the legacy envelope", () => {
    const preRotationEnv = makeEnv({ currentSecret: oldSecret, currentKeyId: "v1" });
    const preRotationCipher = makeAiCipher(preRotationEnv);
    const legacyEnvelope = stripKeyId(preRotationCipher.encryptJson(payload));

    // Rotated keyring with WRONG retired key (old secret not present)
    const wrongRetiredEnv = makeEnv({
      currentSecret: newSecret,
      currentKeyId: "v2",
      retiredSecrets: { v1: "completely-wrong-old-secret" }
    });
    const wrongCipher = makeAiCipher(wrongRetiredEnv);

    expect(() => wrongCipher.decryptJson(legacyEnvelope)).toThrow(
      "Legacy AI secret envelope: no key could authenticate it"
    );
  });
});

// ---------------------------------------------------------------------------
// resolveKeyring unit — legacyCandidates shape
// ---------------------------------------------------------------------------

describe("resolveKeyring — legacyCandidates", () => {
  it("legacyCandidates contains only current key when no retired keys configured", () => {
    const keyring = resolveKeyring("K", "KID", "KS", "dev-default", {
      K: "my-secret",
      KID: "v1"
    } as NodeJS.ProcessEnv);
    expect(keyring.legacyCandidates).toHaveLength(1);
    expect(keyring.legacyCandidates[0]).toEqual(makeKeyBuffer("my-secret"));
  });

  it("legacyCandidates contains current + retired when retired keys configured", () => {
    const keyring = resolveKeyring("K", "KID", "KS", "dev-default", {
      K: "new-secret",
      KID: "v2",
      KS: JSON.stringify({ v1: "old-secret" })
    } as NodeJS.ProcessEnv);
    expect(keyring.legacyCandidates).toHaveLength(2);
    expect(keyring.legacyCandidates[0]).toEqual(makeKeyBuffer("new-secret")); // current first
    expect(keyring.legacyCandidates[1]).toEqual(makeKeyBuffer("old-secret")); // retired second
  });
});
