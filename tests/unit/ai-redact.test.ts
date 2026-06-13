import { describe, expect, it } from "vitest";

import { redactSecrets } from "../../packages/ai/src/adapters/redact.js";

describe("redactSecrets", () => {
  it("returns an empty string for undefined/empty input", () => {
    expect(redactSecrets(undefined)).toBe("");
    expect(redactSecrets("")).toBe("");
  });

  it("redacts a JARVIS_MCP_TOKEN=<value> env-var prefix", () => {
    const out = redactSecrets("cmd failed: JARVIS_MCP_TOKEN=jst_abc123XYZ codex --sandbox");
    expect(out).not.toContain("jst_abc123XYZ");
    expect(out).not.toContain("JARVIS_MCP_TOKEN=jst_");
    expect(out).toContain("[redacted]");
    // Non-secret context is preserved.
    expect(out).toContain("codex --sandbox");
  });

  it("redacts an Authorization Bearer header value", () => {
    const out = redactSecrets("header Authorization: Bearer jst_tok-en_value");
    expect(out).not.toContain("jst_tok-en_value");
    expect(out).not.toMatch(/Bearer\s+jst_/);
    expect(out).toContain("[redacted]");
  });

  it("redacts a bare jst_ session token anywhere it appears", () => {
    const out = redactSecrets("token jst_deadbeefCAFE0123 leaked into stderr");
    expect(out).not.toContain("jst_deadbeefCAFE0123");
    expect(out).toContain("[redacted]");
    expect(out).toContain("leaked into stderr");
  });

  it("leaves non-secret text untouched", () => {
    const clean = "tmux new-session failed (code 1): duplicate session name";
    expect(redactSecrets(clean)).toBe(clean);
  });
});
