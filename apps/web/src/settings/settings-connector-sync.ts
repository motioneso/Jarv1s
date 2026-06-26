import type { ConnectorAccountDto } from "@jarv1s/shared";

export function canSyncConnectorAccount(
  account: Pick<ConnectorAccountDto, "providerType" | "status">
): boolean {
  return account.providerType === "google" && account.status !== "revoked";
}
