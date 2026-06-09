export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_LOOPBACK_REDIRECT = "http://localhost:1";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar"
] as const;

export interface GoogleConnectionSecret extends Record<string, unknown> {
  readonly kind: "google-oauth";
  readonly clientId: string;
  readonly clientSecret: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenExpiry: string; // ISO
  readonly grantedScopes: string[];
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

export interface GoogleOAuthClientDeps {
  readonly fetchFn?: typeof fetch;
}

export function parseRedirectUrl(redirectUrl: string): { code: string; state: string } {
  let url: URL;
  try {
    url = new URL(redirectUrl.trim());
  } catch {
    throw new Error("Pasted redirect URL is not a valid URL");
  }
  const error = url.searchParams.get("error");
  if (error) {
    throw new Error(`Google returned an authorization error: ${error}`);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    throw new Error("Redirect URL is missing the code or state parameter");
  }
  return { code, state };
}

export class GoogleOAuthClient {
  private readonly fetchFn: typeof fetch;

  constructor(deps: GoogleOAuthClientDeps = {}) {
    this.fetchFn = deps.fetchFn ?? globalThis.fetch;
  }

  buildAuthUrl(input: {
    clientId: string;
    scopes: readonly string[];
    redirectUri: string;
    state: string;
  }): string {
    const url = new URL(GOOGLE_AUTH_ENDPOINT);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", input.state);
    url.searchParams.set("scope", input.scopes.join(" "));
    return url.toString();
  }

  async exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<GoogleTokenResponse> {
    return this.postToken({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code"
    });
  }

  async refreshAccessToken(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<GoogleTokenResponse> {
    return this.postToken({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token"
    });
  }

  private async postToken(params: Record<string, string>): Promise<GoogleTokenResponse> {
    const response = await this.fetchFn(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString()
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Google token endpoint returned ${response.status}: ${detail}`);
    }
    return (await response.json()) as GoogleTokenResponse;
  }
}
