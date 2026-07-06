import { describe, expect, it } from "vitest";

import { resolveEffectiveGrants } from "../../packages/connectors/src/feature-grants.js";

describe("resolveEffectiveGrants — imap email.read scope", () => {
  it("grants email for an account whose only scope is email.read", () => {
    const grants = resolveEffectiveGrants(["email.read"], null);
    expect(grants.email).toBe(true);
  });

  it("does not grant email for an account with no recognized scope", () => {
    const grants = resolveEffectiveGrants([], null);
    expect(grants.email).toBe(false);
  });
});
