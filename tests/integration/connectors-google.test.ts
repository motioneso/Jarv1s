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
  GoogleApiError,
  type GmailMessageFull,
  type GoogleCalendarEvent,
  makeCalendarListLiveEventsExecute,
  makeGmailGetLiveMessageExecute,
  makeGmailSearchLiveExecute,
  registerConnectorsRoutes,
  connectorsModuleManifest
} from "@jarv1s/connectors";
import type { ToolContext } from "@jarv1s/module-sdk";
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
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 4 });
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

  it("completeAuthorization rejects malformed pending credentials with GoogleConnectError", async () => {
    const oauthClient = new GoogleOAuthClient({
      fetchFn: (async () =>
        ({
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
        }) as Response) as unknown as typeof fetch
    });
    const service = new GoogleConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      oauthClient,
      generateState: () => "bad-pending"
    });
    await dataContext.withDataContext(userA(), (db) =>
      new ConnectorsRepository().upsertGooglePending(db, {
        state: "bad-pending",
        encryptedSecret: createConnectorSecretCipher().encryptJson({ clientId: "cid" })
      })
    );

    await expect(
      dataContext.withDataContext(userA(), (db) =>
        service.completeAuthorization(db, {
          redirectUrl: "http://localhost:1/?code=4/abc&state=bad-pending"
        })
      )
    ).rejects.toThrow(GoogleConnectError);
  });

  it("getFreshAccessToken rejects malformed stored google credentials with GoogleConnectError", async () => {
    const oauthClient = new GoogleOAuthClient({
      fetchFn: (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "refreshed-at",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/calendar",
            token_type: "Bearer"
          }),
          text: async () => ""
        }) as Response) as unknown as typeof fetch
    });
    const service = new GoogleConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      oauthClient
    });
    await dataContext.withDataContext(userA(), (db) =>
      new ConnectorsRepository().upsertGoogleAccount(db, {
        scopes: ["https://www.googleapis.com/auth/calendar"],
        encryptedSecret: createConnectorSecretCipher().encryptJson({
          kind: "google-oauth",
          clientId: "cid",
          clientSecret: "sec",
          accessToken: "at",
          tokenExpiry: new Date(Date.now() - 60_000).toISOString(),
          grantedScopes: ["https://www.googleapis.com/auth/calendar"]
        })
      })
    );

    await expect(
      dataContext.withDataContext(userA(), (db) => service.getFreshAccessToken(db))
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

  it("deduplicates concurrent refreshes for the same google account", async () => {
    let refreshCalls = 0;
    const oauthClient = new GoogleOAuthClient({
      fetchFn: (async (_url: string, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        const isRefresh = body.includes("grant_type=refresh_token");
        if (isRefresh) {
          refreshCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: isRefresh ? "single-flight-at" : "initial-at",
            refresh_token: "rt",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/calendar",
            token_type: "Bearer"
          }),
          text: async () => ""
        } as Response;
      }) as unknown as typeof fetch
    });
    const service = new GoogleConnectionService({
      repository: new ConnectorsRepository(),
      cipher: createConnectorSecretCipher(),
      oauthClient,
      generateState: () => "single-flight-state",
      now: () => new Date("2026-06-16T00:00:00.000Z")
    });
    await dataContext.withDataContext(userA(), (db) =>
      service.startAuthorization(db, { clientId: "cid", clientSecret: "sec" })
    );
    await dataContext.withDataContext(userA(), (db) =>
      service.completeAuthorization(db, {
        redirectUrl: "http://localhost:1/?code=4/abc&state=single-flight-state"
      })
    );

    const results = await Promise.all([
      dataContext.withDataContext(userA(), (db) =>
        service.getFreshAccessToken(db, { force: true })
      ),
      dataContext.withDataContext(userA(), (db) => service.getFreshAccessToken(db, { force: true }))
    ]);

    expect(results).toEqual(["single-flight-at", "single-flight-at"]);
    expect(refreshCalls).toBe(1);
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

describe("live Google assistant tools", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  const liveAccountId = "00000000-0000-0000-0000-00000000fa00";
  const access = (): AccessContext => ({ actorUserId: ids.userA, requestId: "req:live-google" });
  const ctx: ToolContext = {
    actorUserId: ids.userA,
    requestId: "req:live-google",
    chatSessionId: "chat:live-google"
  };

  beforeAll(async () => {
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 4 });
    dataContext = new DataContextRunner(appDb);
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  it("declares live read tools without required services", () => {
    const names = connectorsModuleManifest.assistantTools?.map((tool) => tool.name) ?? [];
    expect(names).toContain("gmail.searchLive");
    expect(names).toContain("gmail.getLiveMessage");
    expect(names).toContain("calendar.listLiveEvents");

    for (const name of ["gmail.searchLive", "gmail.getLiveMessage", "calendar.listLiveEvents"]) {
      const tool = connectorsModuleManifest.assistantTools?.find((item) => item.name === name);
      expect(tool?.risk).toBe("read");
      expect(
        (tool as { requiresServices?: unknown } | undefined)?.requiresServices
      ).toBeUndefined();
      expect(tool?.externalContent).toBe(true);
    }
  });

  it("returns a sanitized no-active-account failure", async () => {
    const execute = makeGmailSearchLiveExecute({
      googleService: { getFreshAccessToken: async () => "token-1" },
      connectorsRepository: { getActiveGoogleAccountSecret: async () => undefined },
      preferencesRepository: { get: async () => null },
      googleClient: fakeLiveGoogleClient()
    });

    await expect(
      dataContext.withDataContext(access(), (db) => execute(db, {}, ctx))
    ).rejects.toThrow("Connect Google in Settings first.");
  });

  it("lists bounded live gmail results without bodies", async () => {
    const execute = makeGmailSearchLiveExecute({
      googleService: { getFreshAccessToken: async () => "token-1" },
      ...grantedLiveAccount(liveAccountId),
      googleClient: fakeLiveGoogleClient({
        listMessageIds: async () => [{ id: "m1" }],
        getMessage: async () => gmailMessage({ id: "m1", body: "secret body" })
      })
    });

    const result = await dataContext.withDataContext(access(), (db) =>
      execute(db, { query: "from:a", limit: 1 }, ctx)
    );

    expect(result.data).toMatchObject({
      messages: [{ id: "m1", subject: "Hello", snippet: "Snippet" }],
      skipped: 0
    });
    expect(JSON.stringify(result.data)).not.toContain("secret body");
  });

  it("returns a capped live gmail body for one message", async () => {
    const execute = makeGmailGetLiveMessageExecute({
      googleService: { getFreshAccessToken: async () => "token-1" },
      ...grantedLiveAccount(liveAccountId),
      googleClient: fakeLiveGoogleClient({
        getMessage: async () => gmailMessage({ id: "m1", body: "x".repeat(13_000) })
      })
    });

    const result = await dataContext.withDataContext(access(), (db) =>
      execute(db, { id: "m1" }, ctx)
    );

    const message = result.data.message as { bodyText: string };
    expect(message.bodyText).toHaveLength(12_000);
  });

  it("lists bounded live calendar events", async () => {
    const execute = makeCalendarListLiveEventsExecute({
      googleService: { getFreshAccessToken: async () => "token-1" },
      ...grantedLiveAccount(liveAccountId),
      googleClient: fakeLiveGoogleClient({
        listCalendarEvents: async () => [
          {
            id: "e1",
            summary: "Focus",
            start: { dateTime: "2026-06-25T10:00:00.000Z" },
            end: { dateTime: "2026-06-25T11:00:00.000Z" },
            attendees: [{}, {}]
          }
        ]
      }),
      now: () => new Date("2026-06-25T00:00:00.000Z")
    });

    const result = await dataContext.withDataContext(access(), (db) => execute(db, {}, ctx));

    expect(result.data).toMatchObject({
      events: [{ id: "e1", title: "Focus", attendeeCount: 2 }]
    });
  });

  it("forces one refresh and retries after a live Google 401", async () => {
    const tokens: string[] = [];
    let calls = 0;
    const execute = makeCalendarListLiveEventsExecute({
      googleService: {
        getFreshAccessToken: async (_db, opts) => {
          tokens.push(opts?.force ? "forced" : "cached");
          return opts?.force ? "token-2" : "token-1";
        }
      },
      ...grantedLiveAccount(liveAccountId),
      googleClient: fakeLiveGoogleClient({
        listCalendarEvents: async ({ accessToken }) => {
          calls += 1;
          if (accessToken === "token-1") {
            throw new GoogleApiError("Google calendar returned 401", 401);
          }
          return [];
        }
      }),
      now: () => new Date("2026-06-25T00:00:00.000Z")
    });

    await dataContext.withDataContext(access(), (db) => execute(db, {}, ctx));

    expect(calls).toBe(2);
    expect(tokens).toEqual(["cached", "forced"]);
  });
});

function grantedLiveAccount(accountId: string) {
  return {
    connectorsRepository: {
      getActiveGoogleAccountSecret: async () => ({ id: accountId, encryptedSecret: {} as never })
    },
    preferencesRepository: { get: async () => ({ email: true, calendar: true }) }
  };
}

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function gmailMessage(input: { id: string; body: string }): GmailMessageFull {
  return {
    id: input.id,
    threadId: `thread-${input.id}`,
    labelIds: ["INBOX"],
    snippet: "Snippet",
    internalDate: String(Date.parse("2026-06-25T12:00:00.000Z")),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Subject", value: "Hello" },
        { name: "From", value: "a@example.com" },
        { name: "To", value: "b@example.com" }
      ],
      body: { data: b64url(input.body) }
    }
  };
}

function fakeLiveGoogleClient(
  overrides: Partial<{
    listMessageIds(input: {
      accessToken: string;
      query?: string;
      maxPages?: number;
    }): Promise<Array<{ id: string }>>;
    getMessage(input: { accessToken: string; id: string }): Promise<GmailMessageFull>;
    listCalendarEvents(input: {
      accessToken: string;
      calendarId?: string;
      timeMin: string;
      timeMax: string;
      maxPages?: number;
    }): Promise<GoogleCalendarEvent[]>;
  }> = {}
) {
  return {
    listMessageIds: overrides.listMessageIds ?? (async () => []),
    getMessage:
      overrides.getMessage ?? (async ({ id }) => gmailMessage({ id, body: "default body" })),
    listCalendarEvents: overrides.listCalendarEvents ?? (async () => [])
  };
}
