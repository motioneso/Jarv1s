import { describe, expect, it } from "vitest";
import { IMAP_PRESETS, IMAP_PROVIDER_IDS, getImapPreset } from "@jarv1s/connectors/presets";

describe("imap presets", () => {
  it("exposes the four v1 password presets keyed by provider_id", () => {
    expect(IMAP_PROVIDER_IDS).toEqual([
      "imap-yahoo",
      "imap-proton",
      "imap-icloud",
      "imap-fastmail"
    ]);
  });

  it("yahoo preset uses TLS 993 / SMTPS 465 and password auth", () => {
    const yahoo = getImapPreset("imap-yahoo");
    expect(yahoo).toMatchObject({
      imapHost: "imap.mail.yahoo.com",
      imapPort: 993,
      imapTls: true,
      smtpHost: "smtp.mail.yahoo.com",
      smtpPort: 465,
      smtpTls: true,
      authMethod: "password"
    });
  });

  it("proton preset points at local Bridge", () => {
    expect(getImapPreset("imap-proton")).toMatchObject({
      imapHost: "127.0.0.1",
      imapPort: 1143,
      smtpHost: "127.0.0.1",
      smtpPort: 1025
    });
  });

  it("returns undefined for unknown provider", () => {
    expect(getImapPreset("imap-nope")).toBeUndefined();
  });

  it("uses IMAP_PRESETS keys consistent with IMAP_PROVIDER_IDS", () => {
    expect(Object.keys(IMAP_PRESETS).sort()).toEqual([...IMAP_PROVIDER_IDS].sort());
  });
});
