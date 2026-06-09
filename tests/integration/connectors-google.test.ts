import { describe, expect, it } from "vitest";
import { GoogleOAuthClient, GOOGLE_LOOPBACK_REDIRECT, GOOGLE_SCOPES, parseRedirectUrl } from "@jarv1s/connectors";

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
