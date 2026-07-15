import type { ConnectorAccountDto, ConnectorSyncCounts } from "@jarv1s/shared";

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
    | "lastSyncCounts"
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

  if (isConnectorSyncInFlight(account)) {
    return {
      indicator: "idle",
      badgeTone: "neutral",
      label: "Syncing",
      alert: null,
      canReconnect: false
    };
  }

  if (account.lastSyncStatus === "failed") {
    const isAuthFailure = account.lastSyncError === "auth-error";
    return {
      indicator: "error",
      badgeTone: "amber",
      label: "Sign-in expired",
      alert: isAuthFailure
        ? `Last sync failed because ${account.providerType === "google" ? "Google" : "email"} access needs to be reconnected. Reconnect to resume syncing.`
        : syncAlert("Last sync failed", account.lastSyncError, account.lastSyncCounts),
      canReconnect: isAuthFailure || account.providerType === "google"
    };
  }

  if (account.status === "error") {
    return {
      indicator: "error",
      badgeTone: "amber",
      label: "Connection error",
      alert:
        account.providerType === "google"
          ? "Google reported a connection error. Reconnect to restore syncing."
          : "This email account reported a connection error. Reconnect to restore syncing.",
      canReconnect: true
    };
  }

  if (account.lastSyncStatus === "partial") {
    const capped = account.lastSyncCounts?.truncated && !account.lastSyncError;
    return {
      indicator: "error",
      badgeTone: "amber",
      label: capped ? "Message cap reached" : "Partial sync",
      alert: syncAlert(
        capped ? "Last sync reached its message cap" : "Last sync completed with errors",
        account.lastSyncError,
        account.lastSyncCounts
      ),
      canReconnect: false
    };
  }

  if (account.lastSyncStatus === null) {
    return {
      indicator: "idle",
      badgeTone: "neutral",
      label: "Awaiting first sync",
      alert: "First sync hasn't run yet — new data will appear once it completes.",
      canReconnect: false
    };
  }

  return {
    indicator: "ready",
    badgeTone: "pine",
    label: "Synced",
    alert: null,
    canReconnect: false
  };
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function syncAlert(
  prefix: string,
  error: string | null,
  counts: ConnectorSyncCounts | null
): string {
  const details = [syncErrorLabel(error), syncCountsLabel(counts)].filter(Boolean).join(" · ");
  return details
    ? `${prefix}: ${details}. Cached Google data may be stale.`
    : `${prefix}. Cached Google data may be stale.`;
}

function syncErrorLabel(error: string | null): string | null {
  switch (error) {
    case "calendar-error":
      return "Calendar sync failed";
    case "calendar-item-error":
      return "Some calendar items could not be saved";
    case "email-error":
      return "Email sync failed";
    case "email-message-error":
      return "Some email messages could not be saved";
    case "no-active-connection":
      return "No active Google connection";
    case null:
      return null;
    default:
      return error.replace(/-/g, " ");
  }
}

function syncCountsLabel(counts: ConnectorSyncCounts | null): string | null {
  if (!counts) return null;
  const parts: string[] = [];
  if (counts.emailFailures) {
    parts.push(
      `${counts.emailFailures} email message${counts.emailFailures === 1 ? "" : "s"} failed`
    );
  }
  if (counts.truncated) parts.push("message cap reached");
  return parts.length > 0 ? parts.join(", ") : null;
}
