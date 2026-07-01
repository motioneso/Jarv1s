import { describe, expect, it } from "vitest";
import { mapProbeError, smtpTransportOptions } from "@jarv1s/connectors";
import { IMAP_PRESETS } from "@jarv1s/connectors/presets";

describe("mapProbeError", () => {
  it("maps auth rejections to auth_failed", () => {
    expect(mapProbeError({ authenticationFailed: true })).toBe("auth_failed");
    expect(mapProbeError({ responseText: "[AUTHENTICATIONFAILED] Invalid credentials" })).toBe(
      "auth_failed"
    );
  });

  it("maps TLS errors to tls_failed", () => {
    expect(mapProbeError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" })).toBe("tls_failed");
  });

  it("maps connection/DNS errors to unreachable", () => {
    expect(mapProbeError({ code: "ECONNREFUSED" })).toBe("unreachable");
    expect(mapProbeError({ code: "ENOTFOUND" })).toBe("unreachable");
    expect(mapProbeError(new Error("anything else"))).toBe("unreachable");
  });

  it("never returns the raw error text", () => {
    const result = mapProbeError({ responseText: "login failed for user secret@x.com pw=hunter2" });
    expect(["auth_failed", "tls_failed", "unreachable"]).toContain(result);
  });
});

describe("smtpTransportOptions", () => {
  it("maps implicit_tls to a Nodemailer secure connection", () => {
    expect(smtpTransportOptions("implicit_tls")).toEqual({ secure: true, requireTLS: false });
  });

  it("maps starttls to a plaintext connect that requires the STARTTLS upgrade", () => {
    expect(smtpTransportOptions("starttls")).toEqual({ secure: false, requireTLS: true });
  });

  it("maps none to a plain connection with no TLS requirement", () => {
    expect(smtpTransportOptions("none")).toEqual({ secure: false, requireTLS: false });
  });

  it("every preset's smtpSecurity produces the transport options its port convention requires", () => {
    for (const preset of Object.values(IMAP_PRESETS)) {
      const options = smtpTransportOptions(preset.smtpSecurity);
      if (preset.smtpPort === 465) {
        expect(options).toEqual({ secure: true, requireTLS: false });
      } else if (preset.smtpPort === 587) {
        expect(options).toEqual({ secure: false, requireTLS: true });
      }
    }
  });
});
