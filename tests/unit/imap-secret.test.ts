import { describe, expect, it } from "vitest";
import type { Keyring } from "@jarv1s/db";
import {
  ConnectorSecretCipher,
  decryptImapConnectionSecret,
  type ImapConnectionSecret
} from "@jarv1s/connectors";

const keyring: Keyring = {
  currentKeyId: "k1",
  keys: new Map([["k1", Buffer.alloc(32, 7)]]),
  legacyCandidates: []
};
const cipher = new ConnectorSecretCipher(keyring);
const secret: ImapConnectionSecret = {
  kind: "imap-password",
  providerId: "imap-yahoo",
  username: "a@yahoo.com",
  password: "app-pw-123",
  imapHost: "imap.mail.yahoo.com",
  imapPort: 993,
  imapTls: true,
  smtpHost: "smtp.mail.yahoo.com",
  smtpPort: 465,
  smtpTls: true
};

describe("imap secret", () => {
  it("roundtrips through the connector cipher", () => {
    const envelope = cipher.encryptJson(secret);
    expect(decryptImapConnectionSecret(cipher, envelope)).toEqual(secret);
  });

  it("rejects a non-imap secret kind", () => {
    const envelope = cipher.encryptJson({ kind: "google-oauth", refreshToken: "x" });
    expect(() => decryptImapConnectionSecret(cipher, envelope)).toThrow(/imap-password/);
  });

  it("never serializes the password into the envelope JSON", () => {
    const envelope = cipher.encryptJson(secret);
    expect(JSON.stringify(envelope)).not.toContain("app-pw-123");
  });
});
