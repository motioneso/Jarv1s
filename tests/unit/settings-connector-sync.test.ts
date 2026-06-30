import { describe, expect, it } from "vitest";

import {
  canSyncConnectorAccount,
  getConnectorAccountHealth,
  isConnectorSyncInFlight
} from "../../apps/web/src/settings/settings-connector-sync.js";

type HealthAccount = Parameters<typeof getConnectorAccountHealth>[0];

const baseAccount: HealthAccount = {
  providerType: "google",
  status: "active",
  lastSyncStartedAt: "2026-06-30T12:00:00.000Z",
  lastSyncFinishedAt: "2026-06-30T12:00:05.000Z",
  lastSyncStatus: "success",
  lastSyncError: null
};

describe("connector sync account health", () => {
  it("treats a failed Gmail sync as loud needs-attention with a reconnect CTA", () => {
    const health = getConnectorAccountHealth({
      ...baseAccount,
      lastSyncStatus: "failed",
      lastSyncError: "auth-error"
    });

    expect(health).toMatchObject({
      indicator: "error",
      badgeTone: "amber",
      label: "Needs attention",
      canReconnect: true
    });
    expect(health.alert).toContain("Google access needs to be refreshed");
    expect(canSyncConnectorAccount(baseAccount)).toBe(true);
  });

  it("keeps partial syncs visible without sending users through reconnect", () => {
    const health = getConnectorAccountHealth({
      ...baseAccount,
      lastSyncStatus: "partial",
      lastSyncError: "email-message-error"
    });

    expect(health).toMatchObject({
      indicator: "error",
      badgeTone: "amber",
      label: "Partial",
      canReconnect: false
    });
    expect(health.alert).toContain("Cached Google data may be stale");
  });

  it("keeps polling while a started sync has not finished", () => {
    const account = {
      ...baseAccount,
      lastSyncStartedAt: "2026-06-30T12:01:00.000Z",
      lastSyncFinishedAt: "2026-06-30T12:00:05.000Z",
      lastSyncStatus: null
    };

    expect(isConnectorSyncInFlight(account)).toBe(true);
    expect(getConnectorAccountHealth(account)).toMatchObject({
      indicator: "idle",
      badgeTone: "neutral",
      label: "Syncing"
    });
  });

  it("lets revocation win over stale sync metadata", () => {
    const health = getConnectorAccountHealth({
      ...baseAccount,
      status: "revoked",
      lastSyncStatus: "failed",
      lastSyncError: "auth-error"
    });

    expect(health).toMatchObject({
      indicator: "idle",
      badgeTone: "neutral",
      label: "Revoked",
      canReconnect: false
    });
    expect(canSyncConnectorAccount({ providerType: "google", status: "revoked" })).toBe(false);
  });
});
