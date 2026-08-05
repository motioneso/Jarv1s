import { describe, expect, it } from "vitest";

import { resolveAuthOriginConfig } from "../../packages/auth/src/runtime-config.js";

describe("Better Auth origin defaults", () => {
  it("trusts both loopback names on the API's actual dev port", () => {
    expect(resolveAuthOriginConfig({ PORT: "3097" })).toEqual({
      baseURL: "http://localhost:3097",
      trustedOrigins: ["http://localhost:3097", "http://127.0.0.1:3097"]
    });
  });

  it("keeps an explicit trusted-origin list authoritative", () => {
    expect(
      resolveAuthOriginConfig({
        PORT: "3097",
        JARVIS_AUTH_BASE_URL: "https://jarvis.example.com",
        JARVIS_AUTH_TRUSTED_ORIGINS: "https://jarvis.example.com, https://jarvis.lan"
      })
    ).toEqual({
      baseURL: "https://jarvis.example.com",
      trustedOrigins: ["https://jarvis.example.com", "https://jarvis.lan"]
    });
  });
});
