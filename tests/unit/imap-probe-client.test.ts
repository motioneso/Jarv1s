import { describe, expect, it } from "vitest";
import { mapProbeError } from "@jarv1s/connectors";

describe("mapProbeError", () => {
  it("maps auth rejections to auth_failed", () => {
    expect(mapProbeError({ authenticationFailed: true })).toBe("auth_failed");
    expect(mapProbeError({ responseText: "[AUTHENTICATIONFAILED] Invalid credentials" })).toBe("auth_failed");
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
