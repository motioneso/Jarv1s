import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataContextRunner, createDatabase, type AccessContext, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { GoogleOAuthClient, GOOGLE_LOOPBACK_REDIRECT, GOOGLE_SCOPES, parseRedirectUrl, ConnectorsRepository, createConnectorSecretCipher } from "@jarv1s/connectors";
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
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as Response;
  }) as unknown as typeof fetch;
}

describe("parseRedirectUrl", () => {
  it("extracts code and state from a pasted loopback URL", () => {
    expect(parseRedirectUrl("http://localhost:1/?state=s1&code=4/abc&scope=x")).toEqual({ code: "4/abc", state: "s1" });
  });
  it("throws on an error redirect", () => {
    expect(() => parseRedirectUrl("http://localhost:1/?error=access_denied")).toThrow(/access_denied/);
  });
});

describe("GoogleOAuthClient.exchangeCode", () => {
  it("POSTs the auth code and returns tokens", async () => {
    const captured: { body?: string } = {};
    const client = new GoogleOAuthClient({
      fetchFn: fakeFetch(captured, { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "https://www.googleapis.com/auth/calendar", token_type: "Bearer" })
    });
    const tokens = await client.exchangeCode({ clientId: "cid", clientSecret: "secret", code: "4/abc", redirectUri: "http://localhost:1" });
    expect(tokens.refresh_token).toBe("rt");
    const params = new URLSearchParams(captured.body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("4/abc");
    expect(params.get("client_secret")).toBe("secret");
  });
});

describe("GoogleOAuthClient.refreshAccessToken", () => {
  it("POSTs the refresh token and returns a fresh access token", async () => {
    const captured: { body?: string } = {};
    const client = new GoogleOAuthClient({
      fetchFn: fakeFetch(captured, { access_token: "at2", expires_in: 3600, scope: "https://www.googleapis.com/auth/calendar", token_type: "Bearer" })
    });
    const tokens = await client.refreshAccessToken({ clientId: "cid", clientSecret: "secret", refreshToken: "rt" });
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
  afterAll(async () => { await appDb?.destroy(); });

  it("stores and reads back pending auth, then upserts the active google account", async () => {
    const cipher = createConnectorSecretCipher();
    await dataContext.withDataContext(userA(), (db) =>
      repository.upsertGooglePending(db, {
        state: "state-xyz",
        encryptedSecret: cipher.encryptJson({ clientId: "cid", clientSecret: "sec" })
      })
    );
    const pending = await dataContext.withDataContext(userA(), (db) => repository.getGooglePending(db));
    expect(pending?.state).toBe("state-xyz");

    const account = await dataContext.withDataContext(userA(), (db) =>
      repository.upsertGoogleAccount(db, {
        scopes: ["https://www.googleapis.com/auth/calendar"],
        encryptedSecret: cipher.encryptJson({ kind: "google-oauth", accessToken: "at" })
      })
    );
    // ConnectorAccountSafeRow is snake_case — never camelCase
    expect(account.provider_id).toBe("google");
    expect(account.status).toBe("active");

    await dataContext.withDataContext(userA(), (db) => repository.deleteGooglePending(db));
    const after = await dataContext.withDataContext(userA(), (db) => repository.getGooglePending(db));
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
