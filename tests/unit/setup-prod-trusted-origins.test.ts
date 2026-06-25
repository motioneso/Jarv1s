import { describe, expect, it } from "vitest";

import { deriveTrustedOrigins } from "../../scripts/setup-prod-origins.js";

// #379 (v0.1.3): a real deploy is reached over LAN / tailnet / domain, not localhost. The setup
// container can't see the host LAN IP, so install.sh detects it and passes a public origin into
// setup; setup-prod.ts merges it (deduped) with the localhost origin. An explicit
// JARVIS_AUTH_TRUSTED_ORIGINS override still wins verbatim.
describe("deriveTrustedOrigins (#379)", () => {
  it("is localhost-only when no publicOrigin / override (current behavior preserved)", () => {
    expect(deriveTrustedOrigins({ webPort: "1533" })).toBe("http://localhost:1533");
  });

  it("honors a non-default web port for the localhost origin", () => {
    expect(deriveTrustedOrigins({ webPort: "8080" })).toBe("http://localhost:8080");
  });

  it("changes trusted origins with JARVIS_WEB_PORT without changing the default auth base URL", async () => {
    const setupProd = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../scripts/setup-prod.ts", import.meta.url), "utf8")
    );

    expect(deriveTrustedOrigins({ webPort: "5179" })).toBe("http://localhost:5179");
    expect(setupProd).toContain('process.env.JARVIS_AUTH_BASE_URL ?? "http://localhost:3000"');
  });

  it("appends a full publicOrigin verbatim, alongside the localhost origin", () => {
    expect(
      deriveTrustedOrigins({ webPort: "5173", publicOrigin: "http://192.168.1.50:5173" })
    ).toBe("http://localhost:5173,http://192.168.1.50:5173");
  });

  it("supports an https domain publicOrigin", () => {
    expect(
      deriveTrustedOrigins({ webPort: "5173", publicOrigin: "https://jarvis.example.com" })
    ).toBe("http://localhost:5173,https://jarvis.example.com");
  });

  it("normalizes a bare host/IP publicOrigin to http://<host>:<webPort>", () => {
    expect(deriveTrustedOrigins({ webPort: "5173", publicOrigin: "192.168.1.50" })).toBe(
      "http://localhost:5173,http://192.168.1.50:5173"
    );
    expect(deriveTrustedOrigins({ webPort: "5173", publicOrigin: "jarvis.lan" })).toBe(
      "http://localhost:5173,http://jarvis.lan:5173"
    );
  });

  it("dedupes a publicOrigin that equals the localhost origin", () => {
    expect(deriveTrustedOrigins({ webPort: "5173", publicOrigin: "http://localhost:5173" })).toBe(
      "http://localhost:5173"
    );
  });

  it("strips a trailing slash from the publicOrigin", () => {
    expect(
      deriveTrustedOrigins({ webPort: "5173", publicOrigin: "https://jarvis.example.com/" })
    ).toBe("http://localhost:5173,https://jarvis.example.com");
  });

  it("an explicit override wins verbatim (operator took control of the whole list)", () => {
    expect(
      deriveTrustedOrigins({
        webPort: "5173",
        publicOrigin: "http://192.168.1.50:5173",
        override: "https://a.example.com,https://b.example.com"
      })
    ).toBe("https://a.example.com,https://b.example.com");
  });

  it("ignores an empty/whitespace override (falls through to the derived list)", () => {
    expect(
      deriveTrustedOrigins({ webPort: "5173", publicOrigin: "192.168.1.50", override: "  " })
    ).toBe("http://localhost:5173,http://192.168.1.50:5173");
  });
});
