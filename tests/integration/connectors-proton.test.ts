import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AuthSessionResolver,
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import Fastify from "fastify";
import type { Kysely } from "kysely";
import {
  ConnectorsRepository,
  createConnectorSecretCipher,
  decryptProtonBridgeSecret,
  registerConnectorsRoutes,
  ProtonBridgeConnectionService,
  type BridgeProbeClient,
  type ProtonBridgeConnectionHealth
} from "@jarv1s/connectors";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const CREDENTIALS = {
  host: "127.0.0.1",
  port: 1143,
  username: "user@proton.me",
  appPassword: "raw-bridge-app-password",
  tlsMode: "insecure" as const
};

function fakeProbeClient(health: ProtonBridgeConnectionHealth): BridgeProbeClient {
  return { probe: async () => health };
}

describe("Proton Bridge connection repository", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: ConnectorsRepository;
  const userA = (): AccessContext => ({ actorUserId: ids.userA, requestId: "req:a" });
  const userB = (): AccessContext => ({ actorUserId: ids.userB, requestId: "req:b" });

  beforeAll(async () => {
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new ConnectorsRepository();
  });
  afterAll(async () => {
    await appDb?.destroy();
  });

  it("upserts a proton-bridge account, records health, and round-trips the encrypted secret", async () => {
    const cipher = createConnectorSecretCipher();
    const bundle = { kind: "proton-bridge" as const, ...CREDENTIALS };

    const account = await dataContext.withDataContext(userA(), (db) =>
      repository.upsertProtonAccount(db, { encryptedSecret: cipher.encryptJson(bundle) })
    );
    expect(account.provider_id).toBe("proton-bridge");
    expect(account.status).toBe("active");
    expect(account.connection_health_status).toBeNull();

    const withHealth = await dataContext.withDataContext(userA(), (db) =>
      repository.recordConnectionHealth(db, account.id, {
        status: "ok",
        checkedAt: new Date("2026-06-30T00:00:00Z")
      })
    );
    expect(withHealth.connection_health_status).toBe("ok");
    expect(withHealth.connection_health_checked_at).toEqual(new Date("2026-06-30T00:00:00Z"));

    const stored = await dataContext.withDataContext(userA(), (db) =>
      repository.getActiveProtonAccountSecret(db)
    );
    expect(stored).toBeDefined();
    const decrypted = decryptProtonBridgeSecret(cipher, stored!.encryptedSecret);
    expect(decrypted).toEqual(bundle);
  });

  it("scopes the account to its owner — another user sees no active proton-bridge secret", async () => {
    const cipher = createConnectorSecretCipher();
    await dataContext.withDataContext(userA(), (db) =>
      repository.upsertProtonAccount(db, {
        encryptedSecret: cipher.encryptJson({ kind: "proton-bridge", ...CREDENTIALS })
      })
    );

    const asOwner = await dataContext.withDataContext(userA(), (db) =>
      repository.getActiveProtonAccountSecret(db)
    );
    expect(asOwner).toBeDefined();

    const asOtherUser = await dataContext.withDataContext(userB(), (db) =>
      repository.getActiveProtonAccountSecret(db)
    );
    expect(asOtherUser).toBeUndefined();
  });
});

describe("proton connect routes", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let server: ReturnType<typeof Fastify>;

  function buildServer(probeClient: BridgeProbeClient) {
    const protonService = new ProtonBridgeConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      probeClient,
      now: () => new Date("2026-06-30T00:00:00Z")
    });

    const auth = new AuthSessionResolver(appDb);
    const resolveAccessContext = async (request: { headers: { authorization?: string } }) => {
      const authHeader = request.headers.authorization ?? "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!bearerToken) {
        throw new Error("Session is missing or expired");
      }
      return auth.resolveAccessContext(bearerToken);
    };

    const instance = Fastify({ logger: false });
    registerConnectorsRoutes(instance, {
      resolveAccessContext: resolveAccessContext as Parameters<
        typeof registerConnectorsRoutes
      >[1]["resolveAccessContext"],
      dataContext,
      boss: { send: async () => null } as never,
      protonService
    });
    return instance;
  }

  beforeAll(async () => {
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("POST /connect returns 401 without auth", async () => {
    server = buildServer(fakeProbeClient("ok"));
    await server.ready();

    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/proton/connect",
      payload: { ...CREDENTIALS }
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /connect returns 400 with missing fields", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/proton/connect",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {}
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /connect happy path returns 201 + account with ok health, never echoes the app password", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/proton/connect",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { ...CREDENTIALS }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      account: {
        providerId: string;
        status: string;
        hasSecret: boolean;
        connectionHealthStatus: string;
        connectionHealthCheckedAt: string;
      };
    };
    expect(body.account.providerId).toBe("proton-bridge");
    expect(body.account.status).toBe("active");
    expect(body.account.hasSecret).toBe(true);
    expect(body.account.connectionHealthStatus).toBe("ok");
    expect(body.account.connectionHealthCheckedAt).toBe("2026-06-30T00:00:00.000Z");
    expect(JSON.stringify(body)).not.toContain(CREDENTIALS.appPassword);
  });

  it("POST /test-connection re-probes and reports auth_failed without ever leaking the secret", async () => {
    await server.close();
    server = buildServer(fakeProbeClient("auth_failed"));
    await server.ready();

    await server.inject({
      method: "POST",
      url: "/api/connectors/proton/connect",
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { ...CREDENTIALS, host: "10.0.0.1" }
    });

    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/proton/test-connection",
      headers: { authorization: `Bearer ${ids.sessionB}` }
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).not.toContain(CREDENTIALS.appPassword);
  });

  it("POST /test-connection returns 404-class error when no connection exists yet", async () => {
    await server.close();
    server = buildServer(fakeProbeClient("bridge_unreachable"));
    await server.ready();

    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/proton/test-connection",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` }
    });
    expect(res.statusCode).toBe(400);
  });
});
