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
      smtpSecurity: "implicit_tls",
      authMethod: "password"
    });
  });

  it("proton preset points at local Bridge with no SMTP TLS", () => {
    expect(getImapPreset("imap-proton")).toMatchObject({
      imapHost: "127.0.0.1",
      imapPort: 1143,
      smtpHost: "127.0.0.1",
      smtpPort: 1025,
      smtpSecurity: "none"
    });
  });

  it("icloud preset uses STARTTLS on submission port 587, not implicit TLS", () => {
    expect(getImapPreset("imap-icloud")).toMatchObject({
      smtpPort: 587,
      smtpSecurity: "starttls"
    });
  });

  it("fastmail preset uses implicit TLS on SMTPS port 465", () => {
    expect(getImapPreset("imap-fastmail")).toMatchObject({
      smtpPort: 465,
      smtpSecurity: "implicit_tls"
    });
  });

  it("every preset's SMTP security mode matches its port convention (465=implicit_tls, 587=starttls)", () => {
    for (const preset of Object.values(IMAP_PRESETS)) {
      if (preset.smtpPort === 465) {
        expect(preset.smtpSecurity).toBe("implicit_tls");
      } else if (preset.smtpPort === 587) {
        expect(preset.smtpSecurity).toBe("starttls");
      }
    }
  });

  it("returns undefined for unknown provider", () => {
    expect(getImapPreset("imap-nope")).toBeUndefined();
  });

  it("uses IMAP_PRESETS keys consistent with IMAP_PROVIDER_IDS", () => {
    expect(Object.keys(IMAP_PRESETS).sort()).toEqual([...IMAP_PROVIDER_IDS].sort());
  });
});
