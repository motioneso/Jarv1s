import { describe, expect, it } from "vitest";

import {
  createConnectorSecretCipher,
  decryptProtonBridgeSecret,
  ProtonBridgeConnectError,
  ProtonBridgeConnectionService,
  type BridgeProbeClient,
  type ConnectorAccountSafeRow,
  type ConnectorsRepository,
  type ProtonBridgeConnectionHealth
} from "@jarv1s/connectors";
import type { DataContextDb } from "@jarv1s/db";

function fakeAccount(overrides: Partial<ConnectorAccountSafeRow> = {}): ConnectorAccountSafeRow {
  return {
    id: "acct-proton-1",
    provider_id: "proton-bridge",
    provider_type: "proton-bridge",
    provider_display_name: "Proton Mail (Bridge)",
    provider_status: "available",
    owner_user_id: "user-1",
    scopes: [],
    status: "active",
    has_secret: true,
    revoked_at: null,
    created_at: new Date("2026-06-01T00:00:00Z"),
    updated_at: new Date("2026-06-01T00:00:00Z"),
    last_sync_started_at: null,
    last_sync_finished_at: null,
    last_sync_status: null,
    last_sync_error: null,
    last_sync_counts: null,
    connection_health_status: null,
    connection_health_checked_at: null,
    ...overrides
  } as ConnectorAccountSafeRow;
}

function fakeProbeClient(health: ProtonBridgeConnectionHealth): BridgeProbeClient {
  return { probe: async () => health };
}

const CREDENTIALS = {
  host: "127.0.0.1",
  port: 1143,
  username: "user@proton.me",
  appPassword: "raw-bridge-app-password",
  tlsMode: "insecure" as const
};

describe("decryptProtonBridgeSecret", () => {
  it("round-trips a valid bundle through encrypt/decrypt", () => {
    const cipher = createConnectorSecretCipher();
    const encrypted = cipher.encryptJson({ kind: "proton-bridge", ...CREDENTIALS });

    expect(decryptProtonBridgeSecret(cipher, encrypted)).toEqual({
      kind: "proton-bridge",
      ...CREDENTIALS
    });
  });

  it.each([
    ["wrong kind", { kind: "google-oauth", ...CREDENTIALS }],
    ["missing host", { kind: "proton-bridge", ...CREDENTIALS, host: undefined }],
    ["non-numeric port", { kind: "proton-bridge", ...CREDENTIALS, port: "1143" }],
    ["missing username", { kind: "proton-bridge", ...CREDENTIALS, username: undefined }],
    ["missing appPassword", { kind: "proton-bridge", ...CREDENTIALS, appPassword: undefined }],
    ["invalid tlsMode", { kind: "proton-bridge", ...CREDENTIALS, tlsMode: "off" }]
  ])("rejects a malformed bundle: %s", (_label, malformed) => {
    const cipher = createConnectorSecretCipher();
    const encrypted = cipher.encryptJson(malformed as Record<string, unknown>);

    expect(() => decryptProtonBridgeSecret(cipher, encrypted)).toThrow(ProtonBridgeConnectError);
  });
});

describe("ProtonBridgeConnectionService.connect", () => {
  it("persists the account and records ok health on a successful probe", async () => {
    const cipher = createConnectorSecretCipher();
    let upserted: { encryptedSecret: unknown } | undefined;
    let recordedHealth: { accountId: string; status: string } | undefined;
    const repository = {
      upsertProtonAccount: async (_db: DataContextDb, input: { encryptedSecret: unknown }) => {
        upserted = input;
        return fakeAccount();
      },
      recordConnectionHealth: async (
        _db: DataContextDb,
        accountId: string,
        input: { status: ProtonBridgeConnectionHealth; checkedAt: Date }
      ) => {
        recordedHealth = { accountId, status: input.status };
        return fakeAccount({
          connection_health_status: input.status,
          connection_health_checked_at: input.checkedAt
        });
      }
    } as unknown as ConnectorsRepository;

    const service = new ProtonBridgeConnectionService({
      repository,
      cipher,
      probeClient: fakeProbeClient("ok"),
      now: () => new Date("2026-06-30T00:00:00Z")
    });

    const account = await service.connect({} as DataContextDb, CREDENTIALS);

    expect(account.connection_health_status).toBe("ok");
    expect(upserted).toBeDefined();
    expect(recordedHealth).toEqual({ accountId: "acct-proton-1", status: "ok" });
  });

  it("rejects with auth_failed and never persists credentials when the probe fails auth", async () => {
    const cipher = createConnectorSecretCipher();
    let upsertCalled = false;
    const repository = {
      upsertProtonAccount: async () => {
        upsertCalled = true;
        return fakeAccount();
      },
      recordConnectionHealth: async () => fakeAccount()
    } as unknown as ConnectorsRepository;

    const service = new ProtonBridgeConnectionService({
      repository,
      cipher,
      probeClient: fakeProbeClient("auth_failed")
    });

    await expect(service.connect({} as DataContextDb, CREDENTIALS)).rejects.toThrow(
      ProtonBridgeConnectError
    );
    expect(upsertCalled).toBe(false);
  });

  it("rejects with bridge_unreachable when the probe cannot connect", async () => {
    const cipher = createConnectorSecretCipher();
    const repository = {
      upsertProtonAccount: async () => fakeAccount(),
      recordConnectionHealth: async () => fakeAccount()
    } as unknown as ConnectorsRepository;

    const service = new ProtonBridgeConnectionService({
      repository,
      cipher,
      probeClient: fakeProbeClient("bridge_unreachable")
    });

    await expect(service.connect({} as DataContextDb, CREDENTIALS)).rejects.toThrow(
      ProtonBridgeConnectError
    );
  });

  it("never leaks the raw app password in a thrown connect error", async () => {
    const cipher = createConnectorSecretCipher();
    const repository = {
      upsertProtonAccount: async () => fakeAccount(),
      recordConnectionHealth: async () => fakeAccount()
    } as unknown as ConnectorsRepository;

    const service = new ProtonBridgeConnectionService({
      repository,
      cipher,
      probeClient: fakeProbeClient("auth_failed")
    });

    try {
      await service.connect({} as DataContextDb, CREDENTIALS);
      throw new Error("expected connect() to throw");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(CREDENTIALS.appPassword);
    }
  });
});

describe("ProtonBridgeConnectionService.testConnection", () => {
  it("re-probes the stored credentials and records the result", async () => {
    const cipher = createConnectorSecretCipher();
    const encryptedSecret = cipher.encryptJson({ kind: "proton-bridge", ...CREDENTIALS });
    let recorded: ProtonBridgeConnectionHealth | undefined;
    const repository = {
      getActiveProtonAccountSecret: async () => ({ id: "acct-proton-1", encryptedSecret }),
      recordConnectionHealth: async (
        _db: DataContextDb,
        _accountId: string,
        input: { status: ProtonBridgeConnectionHealth }
      ) => {
        recorded = input.status;
        return fakeAccount({ connection_health_status: input.status });
      }
    } as unknown as ConnectorsRepository;

    const service = new ProtonBridgeConnectionService({
      repository,
      cipher,
      probeClient: fakeProbeClient("ok")
    });

    const account = await service.testConnection({} as DataContextDb);

    expect(recorded).toBe("ok");
    expect(account.connection_health_status).toBe("ok");
  });

  it("rejects when there is no active proton-bridge connection", async () => {
    const cipher = createConnectorSecretCipher();
    const repository = {
      getActiveProtonAccountSecret: async () => undefined
    } as unknown as ConnectorsRepository;

    const service = new ProtonBridgeConnectionService({
      repository,
      cipher,
      probeClient: fakeProbeClient("ok")
    });

    await expect(service.testConnection({} as DataContextDb)).rejects.toThrow(
      ProtonBridgeConnectError
    );
  });
});
