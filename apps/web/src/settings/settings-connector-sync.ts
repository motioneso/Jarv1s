import type { ConnectorAccountDto } from "@jarv1s/shared";

export type ConnectorAccountHealth = {
  readonly indicator: "ready" | "error" | "idle";
  readonly badgeTone: "pine" | "amber" | "neutral";
  readonly label: string;
  readonly alert: string | null;
  readonly canReconnect: boolean;
};

export function isConnectorSyncInFlight(
  account: Pick<ConnectorAccountDto, "lastSyncStartedAt" | "lastSyncFinishedAt">
): boolean {
  const startedAt = parseTimestamp(account.lastSyncStartedAt);
  if (startedAt === null) return false;
  const finishedAt = parseTimestamp(account.lastSyncFinishedAt);
  return finishedAt === null || finishedAt < startedAt;
}

export function getConnectorAccountHealth(
  account: Pick<
    ConnectorAccountDto,
    | "providerType"
    | "status"
    | "lastSyncStartedAt"
    | "lastSyncFinishedAt"
    | "lastSyncStatus"
    | "lastSyncError"
  >
): ConnectorAccountHealth {
  if (account.status === "revoked") {
    return {
      indicator: "idle",
      badgeTone: "neutral",
      label: "Revoked",
      alert: null,
      canReconnect: false
    };
  }

  if (account.lastSyncStatus === "failed") {
    return {
      indicator: "error",
      badgeTone: "amber",
      label: "Needs attention",
      alert:
        account.lastSyncError === "auth-error"
          ? "Last sync failed because Google access needs to be refreshed."
          : "Last sync failed. Cached Google data may be stale.",
      canReconnect: account.providerType === "google"
    };
  }

  if (account.status === "error") {
    return {
      indicator: "error",
      badgeTone: "amber",
      label: "Needs attention",
      alert: "Connection needs attention.",
      canReconnect: account.providerType === "google"
    };
  }

  if (account.lastSyncStatus === "partial") {
    return {
      indicator: "error",
      badgeTone: "amber",
      label: "Partial",
      alert: "Last sync completed with errors. Cached Google data may be stale.",
      canReconnect: false
    };
  }

  if (isConnectorSyncInFlight(account)) {
    return {
      indicator: "idle",
      badgeTone: "neutral",
      label: "Syncing",
      alert: null,
      canReconnect: false
    };
  }

  if (account.lastSyncStatus === null) {
    return {
      indicator: "idle",
      badgeTone: "neutral",
      label: "Awaiting first sync",
      alert: null,
      canReconnect: false
    };
  }

  return {
    indicator: "ready",
    badgeTone: "pine",
    label: "Healthy",
    alert: null,
    canReconnect: false
  };
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
