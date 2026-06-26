import { describe, expect, it } from "vitest";

import { canSyncConnectorAccount } from "../../apps/web/src/settings/settings-connector-sync.js";

describe("canSyncConnectorAccount", () => {
  it("allows active Google accounts", () => {
    expect(canSyncConnectorAccount({ providerType: "google", status: "active" })).toBe(true);
  });

  it("blocks revoked Google accounts and non-Google accounts", () => {
    expect(canSyncConnectorAccount({ providerType: "google", status: "revoked" })).toBe(false);
    expect(canSyncConnectorAccount({ providerType: "email", status: "active" })).toBe(false);
  });
});
