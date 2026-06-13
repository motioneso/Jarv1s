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
  GoogleOAuthClient,
  GOOGLE_LOOPBACK_REDIRECT,
  GOOGLE_SCOPES,
  parseRedirectUrl,
  ConnectorsRepository,
  createConnectorSecretCipher,
  GoogleConnectionService,
  GoogleConnectError,
  registerConnectorsRoutes,
  connectorsModuleManifest
} from "@jarv1s/connectors";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("GoogleOAuthClient.buildAuthUrl", () => {
  it("builds a consent URL with offline access, forced consent, scopes and state", () => {
    const client = new GoogleOAuthClient();
    const url = new URL(
      client.buildAuthUrl({
        clientId: "cid.apps.googleusercontent.com",
        scopes: GOOGLE_SCOPES,
        redirectUri: GOOGLE_LOOPBACK_REDIRECT,
        state: "state-123"
      })
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe(GOOGLE_LOOPBACK_REDIRECT);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_SCOPES.join(" "));
  });
});

function fakeFetch(captured: { body?: string }, payload: object): typeof fetch {
  return (async (_url: string, init?: { body?: BodyInit | null }) => {
    captured.body = String(init?.body ?? "");
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    } as Response;
  }) as unknown as typeof fetch;
}

describe("parseRedirectUrl", () => {
  it("extracts code and state from a pasted loopback URL", () => {
    expect(parseRedirectUrl("http://localhost:1/?state=s1&code=4/abc&scope=x")).toEqual({
      code: "4/abc",
      state: "s1"
    });
  });
  it("throws on an error redirect", () => {
    expect(() => parseRedirectUrl("http://localhost:1/?error=access_denied")).toThrow(
      /access_denied/
    );
  });
});

describe("GoogleOAuthClient.exchangeCode", () => {
  it("POSTs the auth code and returns tokens", async () => {
    const captured: { body?: string } = {};
    const client = new GoogleOAuthClient({
      fetchFn: fakeFetch(captured, {
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
        token_type: "Bearer"
      })
    });
    const tokens = await client.exchangeCode({
      clientId: "cid",
      clientSecret: "secret",
      code: "4/abc",
      redirectUri: "http://localhost:1"
    });
    expect(tokens.refresh_token).toBe("rt");
    const params = new URLSearchParams(captured.body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("4/abc");
    expect(params.get("client_secret")).toBe("secret");
  });

  it("does not include token-endpoint error body in the thrown Error message OR the log", async () => {
    const loggedErrors: Array<{ statusCode: number; detail?: string }> = [];
    const fakeLogger = {
      error: (data: { statusCode: number; detail?: string }, _msg: string) => {
        loggedErrors.push(data);
      }
    };
    const errorBody =
      '{"error":"invalid_client","error_description":"The OAuth client was not found."}';
    const client = new GoogleOAuthClient({
      fetchFn: (async () => ({
        ok: false,
        status: 401,
        text: async () => errorBody,
        json: async () => ({})
      })) as unknown as typeof fetch,
      logger: fakeLogger
    });

    await expect(
      client.exchangeCode({
        clientId: "bad-client",
        clientSecret: "bad-secret",
        code: "bad-code",
        redirectUri: "http://localhost:1"
      })
    ).rejects.toThrow(/Google token endpoint returned 401/);

    // The error message must NOT contain the raw detail.
    const caughtError = await client
      .exchangeCode({
        clientId: "bad-client",
        clientSecret: "bad-secret",
        code: "bad-code",
        redirectUri: "http://localhost:1"
      })
      .catch((e: Error) => e);
    expect((caughtError as Error).message).not.toContain("invalid_client");
    expect((caughtError as Error).message).not.toContain("The OAuth client was not found");

    // The status is logged server-side, but the error body detail is NOT logged at all
    // (needless data exposure / could capture a future field) — status only.
    expect(loggedErrors.length).toBeGreaterThanOrEqual(1);
    expect(loggedErrors[0]?.statusCode).toBe(401);
    expect(loggedErrors[0]?.detail).toBeUndefined();
    expect(JSON.stringify(loggedErrors)).not.toContain("invalid_client");
    expect(JSON.stringify(loggedErrors)).not.toContain("The OAuth client was not found");
  });
});

describe("GoogleOAuthClient.refreshAccessToken", () => {
  it("POSTs the refresh token and returns a fresh access token", async () => {
    const captured: { body?: string } = {};
    const client = new GoogleOAuthClient({
      fetchFn: fakeFetch(captured, {
        access_token: "at2",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
        token_type: "Bearer"
      })
    });
    const tokens = await client.refreshAccessToken({
      clientId: "cid",
      clientSecret: "secret",
      refreshToken: "rt"
    });
    expect(tokens.access_token).toBe("at2");
    expect(new URLSearchParams(captured.body).get("grant_type")).toBe("refresh_token");
  });
});

describe("Google connection repository", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: ConnectorsRepository;
  const userA = (): AccessContext => ({ actorUserId: ids.userA, requestId: "req:a" });

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

  it("stores and reads back pending auth, then upserts the active google account", async () => {
    const cipher = createConnectorSecretCipher();
    await dataContext.withDataContext(userA(), (db) =>
      repository.upsertGooglePending(db, {
        state: "state-xyz",
        encryptedSecret: cipher.encryptJson({ clientId: "cid", clientSecret: "sec" })
      })
    );
    const pending = await dataContext.withDataContext(userA(), (db) =>
      repository.getGooglePending(db)
    );
    expect(pending?.state).toBe("state-xyz");

    const account = await dataContext.withDataContext(userA(), (db) =>
      repository.upsertGoogleAccount(db, {
        scopes: ["https://www.googleapis.com/auth/calendar"],
        encryptedSecret: cipher.encryptJson({ kind: "google-oauth", accessToken: "at" })
      })
    );
    expect(account.provider_id).toBe("google");
    expect(account.status).toBe("active");

    await dataContext.withDataContext(userA(), (db) => repository.deleteGooglePending(db));
    const after = await dataContext.withDataContext(userA(), (db) =>
      repository.getGooglePending(db)
    );
    expect(after).toBeUndefined();
  });

  it("getActiveGoogleAccountSecret returns the encrypted secret for an active google account", async () => {
    const cipher = createConnectorSecretCipher();
    await dataContext.withDataContext(userA(), (db) =>
      repository.upsertGoogleAccount(db, {
        scopes: ["https://www.googleapis.com/auth/calendar"],
        encryptedSecret: cipher.encryptJson({ kind: "google-oauth", accessToken: "at2" })
      })
    );
    const result = await dataContext.withDataContext(userA(), (db) =>
      repository.getActiveGoogleAccountSecret(db)
    );
    expect(result).toBeDefined();
    expect(result?.id).toBeTruthy();
    const decrypted = cipher.decryptJson(result!.encryptedSecret);
    expect(decrypted.accessToken).toBe("at2");
  });
});

describe("GoogleConnectionService", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  const userA = (): AccessContext => ({ actorUserId: ids.userA, requestId: "req:a" });

  beforeAll(async () => {
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });
  afterAll(async () => {
    await appDb?.destroy();
  });

  it("startAuthorization stores pending creds and returns an auth URL", async () => {
    const service = new GoogleConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      oauthClient: new GoogleOAuthClient(),
      generateState: () => "fixed-state"
    });
    const result = await dataContext.withDataContext(userA(), (db) =>
      service.startAuthorization(db, { clientId: "cid", clientSecret: "sec" })
    );
    expect(result.authUrl).toContain("state=fixed-state");
    expect(result.authUrl).toContain("accounts.google.com");
    const pending = await dataContext.withDataContext(userA(), (db) =>
      new ConnectorsRepository().getGooglePending(db)
    );
    expect(pending?.state).toBe("fixed-state");
  });

  it("completeAuthorization validates state, exchanges code, and stores tokens", async () => {
    const oauthClient = new GoogleOAuthClient({
      fetchFn: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar",
          token_type: "Bearer"
        }),
        text: async () => ""
      })) as unknown as typeof fetch
    });
    const service = new GoogleConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      oauthClient,
      generateState: () => "fixed-state"
    });
    await dataContext.withDataContext(userA(), (db) =>
      service.startAuthorization(db, { clientId: "cid", clientSecret: "sec" })
    );
    const account = await dataContext.withDataContext(userA(), (db) =>
      service.completeAuthorization(db, {
        redirectUrl: "http://localhost:1/?code=4/abc&state=fixed-state"
      })
    );
    expect(account.provider_id).toBe("google");
    expect(account.status).toBe("active");
  });

  it("completeAuthorization rejects a mismatched state with GoogleConnectError", async () => {
    const service = new GoogleConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      oauthClient: new GoogleOAuthClient(),
      generateState: () => "fixed-state"
    });
    await dataContext.withDataContext(userA(), (db) =>
      service.startAuthorization(db, { clientId: "cid", clientSecret: "sec" })
    );
    await expect(
      dataContext.withDataContext(userA(), (db) =>
        service.completeAuthorization(db, {
          redirectUrl: "http://localhost:1/?code=4/abc&state=WRONG"
        })
      )
    ).rejects.toThrow(GoogleConnectError);
  });

  it("getFreshAccessToken returns a valid token without refreshing when not near expiry", async () => {
    const oauthClient = new GoogleOAuthClient({
      fetchFn: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar",
          token_type: "Bearer"
        }),
        text: async () => ""
      })) as unknown as typeof fetch
    });
    const service = new GoogleConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      oauthClient,
      generateState: () => "s",
      now: () => new Date()
    });
    await dataContext.withDataContext(userA(), (db) =>
      service.startAuthorization(db, { clientId: "cid", clientSecret: "sec" })
    );
    await dataContext.withDataContext(userA(), (db) =>
      service.completeAuthorization(db, { redirectUrl: "http://localhost:1/?code=4/abc&state=s" })
    );
    const token = await dataContext.withDataContext(userA(), (db) =>
      service.getFreshAccessToken(db)
    );
    expect(token).toBe("at");
  });

  it("getFreshAccessToken({ force: true }) refreshes once even when the cached token is still valid", async () => {
    let refreshCalls = 0;
    const oauthClient = new GoogleOAuthClient({
      fetchFn: (async (_url: string, init?: RequestInit) => {
        // exchangeCode and refreshAccessToken both POST to the token endpoint; distinguish by
        // the grant_type in the body so we count only refresh calls.
        const body = String(init?.body ?? "");
        if (body.includes("grant_type=refresh_token")) refreshCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: refreshCalls > 0 ? "refreshed-at" : "at",
            refresh_token: "rt",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/calendar",
            token_type: "Bearer"
          }),
          text: async () => ""
        };
      }) as unknown as typeof fetch
    });
    const service = new GoogleConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      oauthClient,
      generateState: () => "force-state",
      now: () => new Date()
    });
    await dataContext.withDataContext(userA(), (db) =>
      service.startAuthorization(db, { clientId: "cid", clientSecret: "sec" })
    );
    await dataContext.withDataContext(userA(), (db) =>
      service.completeAuthorization(db, {
        redirectUrl: "http://localhost:1/?code=4/abc&state=force-state"
      })
    );
    // A still-valid cached token would normally short-circuit; force bypasses that fast path.
    const forced = await dataContext.withDataContext(userA(), (db) =>
      service.getFreshAccessToken(db, { force: true })
    );
    expect(refreshCalls).toBe(1);
    expect(forced).toBe("refreshed-at");
  });
});

describe("google connect routes", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let server: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    const auth = new AuthSessionResolver(appDb);
    dataContext = new DataContextRunner(appDb);

    const fakeOauthClient = new GoogleOAuthClient({
      fetchFn: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "at-from-google",
          refresh_token: "rt-from-google",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar",
          token_type: "Bearer"
        }),
        text: async () => ""
      })) as unknown as typeof fetch
    });

    const googleService = new GoogleConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      oauthClient: fakeOauthClient,
      generateState: () => "test-state-123"
    });

    const resolveAccessContext = async (request: { headers: { authorization?: string } }) => {
      const authHeader = request.headers.authorization ?? "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!bearerToken) {
        throw new Error("Session is missing or expired");
      }
      return auth.resolveAccessContext(bearerToken);
    };

    server = Fastify({ logger: false });
    registerConnectorsRoutes(server, {
      resolveAccessContext: resolveAccessContext as Parameters<
        typeof registerConnectorsRoutes
      >[1]["resolveAccessContext"],
      dataContext,
      // Sync-on-connect enqueues a best-effort google-sync job on POST /complete; a no-op
      // fake boss keeps these OAuth-route tests focused on the connect flow (G2).
      boss: { send: async () => null } as never,
      googleService
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("POST /authorize returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/google/authorize",
      payload: { clientId: "cid", clientSecret: "sec" }
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /authorize returns 400 with missing fields", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/google/authorize",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {}
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /authorize with valid creds returns 200 + authUrl", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/google/authorize",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { clientId: "cid.apps.googleusercontent.com", clientSecret: "secret" }
    });
    expect(res.statusCode).toBe(200);
    const authorizeBody = res.json() as { authUrl: string };
    expect(authorizeBody.authUrl).toContain("accounts.google.com");
    expect(authorizeBody.authUrl).toContain("state=test-state-123");
  });

  it("POST /complete returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/google/complete",
      payload: { redirectUrl: "http://localhost:1/?code=x&state=y" }
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /complete with wrong state returns 400 (GoogleConnectError mapped by type)", async () => {
    await server.inject({
      method: "POST",
      url: "/api/connectors/google/authorize",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { clientId: "cid", clientSecret: "sec" }
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/google/complete",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { redirectUrl: "http://localhost:1/?code=4/abc&state=WRONG-STATE" }
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("state");
  });

  it("POST /complete happy path returns 201 + account", async () => {
    await server.inject({
      method: "POST",
      url: "/api/connectors/google/authorize",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { clientId: "cid", clientSecret: "sec" }
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/connectors/google/complete",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { redirectUrl: `http://localhost:1/?code=4/abc&state=test-state-123` }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { account: { providerId: string; status: string } };
    expect(body.account.providerId).toBe("google");
    expect(body.account.status).toBe("active");
  });
});

describe("connectors.startGoogleGuidance tool", () => {
  it("is declared in the connectors manifest with execute and read risk", () => {
    const tool = connectorsModuleManifest.assistantTools?.find(
      (t) => t.name === "connectors.startGoogleGuidance"
    );
    expect(tool).toBeDefined();
    expect(tool?.risk).toBe("read");
    expect(tool?.execute).toBeDefined();
  });

  it("returns steps + settingsUrl and no secrets", async () => {
    const tool = connectorsModuleManifest.assistantTools?.find(
      (t) => t.name === "connectors.startGoogleGuidance"
    );
    const result = await tool!.execute!(
      null as unknown,
      {},
      { actorUserId: "u1", requestId: "r1", chatSessionId: "s1" }
    );
    expect(Array.isArray(result.data.steps)).toBe(true);
    expect((result.data.steps as string[]).length).toBeGreaterThan(0);
    expect(result.data.settingsUrl).toBe("/settings");
    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain("clientSecret");
    expect(serialized).not.toContain("accessToken");
  });
});
