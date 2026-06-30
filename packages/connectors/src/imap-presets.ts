export type ImapAuthMethod = "password" | "xoauth2";

export interface ImapPreset {
  readonly providerId: string;
  readonly displayName: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapTls: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpTls: boolean;
  readonly authMethod: ImapAuthMethod;
  /** Operator-facing note shown in the connect form, e.g. Proton's Bridge prerequisite. */
  readonly prerequisite?: string;
}

export const IMAP_PRESETS: Record<string, ImapPreset> = {
  "imap-yahoo": {
    providerId: "imap-yahoo",
    displayName: "Yahoo Mail",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    imapTls: true,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    smtpTls: true,
    authMethod: "password",
    prerequisite: "Generate an app password in Yahoo Account Security; your normal password will not work."
  },
  "imap-proton": {
    providerId: "imap-proton",
    displayName: "Proton Mail (Bridge)",
    imapHost: "127.0.0.1",
    imapPort: 1143,
    imapTls: false,
    smtpHost: "127.0.0.1",
    smtpPort: 1025,
    smtpTls: false,
    authMethod: "password",
    prerequisite:
      "Requires a paid Proton plan with Proton Mail Bridge installed and running on (or reachable from) this host."
  },
  "imap-icloud": {
    providerId: "imap-icloud",
    displayName: "iCloud Mail",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapTls: true,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpTls: true,
    authMethod: "password",
    prerequisite: "Generate an app-specific password at appleid.apple.com."
  },
  "imap-fastmail": {
    providerId: "imap-fastmail",
    displayName: "Fastmail",
    imapHost: "imap.fastmail.com",
    imapPort: 993,
    imapTls: true,
    smtpHost: "smtp.fastmail.com",
    smtpPort: 465,
    smtpTls: true,
    authMethod: "password",
    prerequisite: "Generate an app password in Fastmail Settings → Privacy & Security."
  }
};

export const IMAP_PROVIDER_IDS = Object.keys(IMAP_PRESETS) as readonly string[];

export function getImapPreset(providerId: string): ImapPreset | undefined {
  return IMAP_PRESETS[providerId];
}
