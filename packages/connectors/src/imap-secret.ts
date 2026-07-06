import type { ConnectorSecretCipher, EncryptedConnectorSecret } from "./crypto.js";
import type { SmtpSecurityMode } from "./imap-presets.js";

export interface ImapConnectionSecret extends Record<string, unknown> {
  readonly kind: "imap-password";
  readonly providerId: string;
  readonly username: string;
  readonly password: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapTls: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpSecurity: SmtpSecurityMode;
}

export function decryptImapConnectionSecret(
  cipher: ConnectorSecretCipher,
  envelope: EncryptedConnectorSecret
): ImapConnectionSecret {
  const value = cipher.decryptJson(envelope) as Partial<ImapConnectionSecret>;
  if (value.kind !== "imap-password") {
    throw new Error(`Expected an imap-password connector secret, got kind=${String(value.kind)}`);
  }
  for (const field of ["providerId", "username", "password", "imapHost", "smtpHost"] as const) {
    if (typeof value[field] !== "string" || value[field] === "") {
      throw new Error(`imap-password secret missing required field: ${field}`);
    }
  }
  return value as ImapConnectionSecret;
}
