import { describe, expect, it } from "vitest";

import {
  createConnectorSecretCipher,
  loadGoogleSyncActiveAccount,
  type ConnectorsRepository,
  type SyncLogger
} from "@jarv1s/connectors";
import type { DataContextDb } from "@jarv1s/db";

describe("loadGoogleSyncActiveAccount", () => {
  it("treats malformed stored Google secrets as no usable account without logging secret fields", async () => {
    const cipher = createConnectorSecretCipher();
    const logEntries: Array<{ data: Record<string, unknown>; message: string }> = [];
    const logger: SyncLogger = {
      warn: (data, message) => logEntries.push({ data, message }),
      info: () => undefined
    };
    const repository = {
      getActiveGoogleAccountSecret: async () => ({
        id: "acct-1",
        encryptedSecret: cipher.encryptJson({
          kind: "google-oauth",
          accessToken: "raw-access-token",
          refreshToken: "raw-refresh-token",
          clientSecret: "raw-client-secret"
        })
      })
    } as unknown as ConnectorsRepository;

    const result = await loadGoogleSyncActiveAccount(
      repository,
      cipher,
      {} as DataContextDb,
      logger
    );

    expect(result).toBeUndefined();
    const logged = JSON.stringify(logEntries);
    expect(logged).toContain("google-sync stored connection invalid");
    expect(logged).not.toContain("raw-access-token");
    expect(logged).not.toContain("raw-refresh-token");
    expect(logged).not.toContain("raw-client-secret");
  });
});
