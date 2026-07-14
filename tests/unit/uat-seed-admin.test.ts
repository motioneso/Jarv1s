import { afterEach, describe, expect, it, vi } from "vitest";
import { logUatAdminCredentials, UAT_ADMIN_EMAIL, UAT_ADMIN_PASSWORD } from "../uat/seed/admin.js";

describe("logUatAdminCredentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prints seeded owner credentials for a confirmed UAT run", () => {
    const output: string[] = [];
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JARVIS_UAT_SEED_CONFIRM", "1");

    logUatAdminCredentials({ email: UAT_ADMIN_EMAIL, password: UAT_ADMIN_PASSWORD }, (text) =>
      output.push(text)
    );

    const logged = output.join("");
    // Exact allowlist: the sink may receive only the deterministic fixture login.
    expect(output).toEqual([
      `[uat-seed] owner/admin login: email=${UAT_ADMIN_EMAIL} password=${UAT_ADMIN_PASSWORD}\n`
    ]);
    expect(logged).not.toMatch(/\b[a-f0-9]{32}:[a-f0-9]{128}\b/i); // better-auth scrypt hash
    expect(logged).not.toMatch(
      /password_hash|session_token|access_token|refresh_token|id_token|client_secret/i
    );
  });

  it("prints nothing in production mode without UAT seed confirmation", () => {
    const output: string[] = [];
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JARVIS_UAT_SEED_CONFIRM", undefined);

    logUatAdminCredentials({ email: UAT_ADMIN_EMAIL, password: UAT_ADMIN_PASSWORD }, (text) =>
      output.push(text)
    );

    expect(output).toEqual([]);
  });
});
