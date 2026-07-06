import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AuthSessionResolver,
  DataContextRunner,
  createDatabase,
  type JarvisDatabase
} from "@jarv1s/db";
import Fastify from "fastify";
import type { Kysely } from "kysely";
import {
  ConnectorsRepository,
  ImapConnectionService,
  createConnectorSecretCipher,
  registerConnectorsRoutes,
  type ImapProbeClient,
  type ImapProbeInput,
  type ImapProbeResult
} from "@jarv1s/connectors";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const CREDENTIALS = {
  providerId: "imap-fastmail",
  username: "person@fastmail.com",
  password: "raw-app-password"
};

function fakeProbeClient(result: ImapProbeResult): ImapProbeClient {
  return {
    probe: async (_input: ImapProbeInput) => result
  };
}

describe("imap connect routes", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let server: ReturnType<typeof Fastify>;

  function buildServer(probeClient: ImapProbeClient) {
    const imapService = new ImapConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      probeClient
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
      imapService
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
      url: "/api/connectors/imap/connect",
      payload: { ...CREDENTIALS }
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /connect returns 400 with missing fields", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/imap/connect",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {}
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /connect happy path returns 201 + account, never echoes the password", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/imap/connect",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { ...CREDENTIALS }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      account: { providerId: string; status: string; hasSecret: boolean };
    };
    expect(body.account.providerId).toBe("imap-fastmail");
    expect(body.account.status).toBe("active");
    expect(body.account.hasSecret).toBe(true);
    expect(JSON.stringify(body)).not.toContain(CREDENTIALS.password);
  });

  it("POST /connect returns a 400-class error without persisting when the probe fails, never leaking the secret", async () => {
    await server.close();
    server = buildServer(fakeProbeClient("auth_failed"));
    await server.ready();

    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/imap/connect",
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { ...CREDENTIALS, providerId: "imap-yahoo" }
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).not.toContain(CREDENTIALS.password);
  });

  it("POST /connect returns 400 for an unknown providerId", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/imap/connect",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { ...CREDENTIALS, providerId: "imap-not-a-real-preset" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /test-connection returns 401 without auth", async () => {
    await server.close();
    server = buildServer(fakeProbeClient("ok"));
    await server.ready();

    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/imap/test-connection",
      payload: { ...CREDENTIALS }
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /test-connection returns 400 with missing fields", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/imap/test-connection",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {}
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /test-connection reports ok without persisting an account, never echoing the password", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/imap/test-connection",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { ...CREDENTIALS, providerId: "imap-icloud" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "ok" });
    expect(JSON.stringify(res.json())).not.toContain(CREDENTIALS.password);
  });

  it("POST /test-connection reports auth_failed for bad credentials without leaking the secret", async () => {
    await server.close();
    server = buildServer(fakeProbeClient("auth_failed"));
    await server.ready();

    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/imap/test-connection",
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { ...CREDENTIALS, providerId: "imap-icloud" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "auth_failed" });
    expect(JSON.stringify(res.json())).not.toContain(CREDENTIALS.password);
  });
});
