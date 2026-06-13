import { randomUUID } from "node:crypto";

import type { DataContextDb } from "@jarv1s/db";

import type { ConnectorSecretCipher } from "./crypto.js";
import {
  GOOGLE_LOOPBACK_REDIRECT,
  GOOGLE_SCOPES,
  parseRedirectUrl,
  type GoogleConnectionSecret,
  type GoogleOAuthClient
} from "./oauth.js";
import type { ConnectorAccountSafeRow, ConnectorsRepository } from "./repository.js";

export class GoogleConnectError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "GoogleConnectError";
  }
}

export interface GoogleConnectionServiceDeps {
  readonly repository: ConnectorsRepository;
  readonly cipher: ConnectorSecretCipher;
  readonly oauthClient: GoogleOAuthClient;
  readonly generateState?: () => string;
  readonly now?: () => Date;
}

export class GoogleConnectionService {
  private readonly generateState: () => string;
  private readonly now: () => Date;

  constructor(private readonly deps: GoogleConnectionServiceDeps) {
    this.generateState = deps.generateState ?? (() => randomUUID());
    this.now = deps.now ?? (() => new Date());
  }

  async startAuthorization(
    scopedDb: DataContextDb,
    input: { clientId: string; clientSecret: string }
  ): Promise<{ authUrl: string }> {
    const state = this.generateState();
    await this.deps.repository.upsertGooglePending(scopedDb, {
      state,
      encryptedSecret: this.deps.cipher.encryptJson({
        clientId: input.clientId,
        clientSecret: input.clientSecret
      })
    });
    const authUrl = this.deps.oauthClient.buildAuthUrl({
      clientId: input.clientId,
      scopes: GOOGLE_SCOPES,
      redirectUri: GOOGLE_LOOPBACK_REDIRECT,
      state
    });
    return { authUrl };
  }

  async completeAuthorization(
    scopedDb: DataContextDb,
    input: { redirectUrl: string }
  ): Promise<ConnectorAccountSafeRow> {
    const { code, state } = parseRedirectUrl(input.redirectUrl);
    const pending = await this.deps.repository.getGooglePending(scopedDb);
    if (!pending) {
      throw new GoogleConnectError(
        "No pending Google authorization found — start the connect flow again"
      );
    }
    if (pending.state !== state) {
      throw new GoogleConnectError(
        "Authorization state did not match — please retry the connect flow"
      );
    }
    const creds = this.deps.cipher.decryptJson(pending.encryptedSecret) as {
      clientId: string;
      clientSecret: string;
    };
    const tokens = await this.deps.oauthClient.exchangeCode({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      code,
      redirectUri: GOOGLE_LOOPBACK_REDIRECT
    });
    if (!tokens.refresh_token) {
      throw new GoogleConnectError(
        "Google did not return a refresh token — re-consent with prompt=consent"
      );
    }
    const expiry = new Date(this.now().getTime() + tokens.expires_in * 1000).toISOString();
    const bundle: GoogleConnectionSecret = {
      kind: "google-oauth",
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: expiry,
      grantedScopes: tokens.scope ? tokens.scope.split(" ") : [...GOOGLE_SCOPES]
    };
    const account = await this.deps.repository.upsertGoogleAccount(scopedDb, {
      scopes: bundle.grantedScopes,
      encryptedSecret: this.deps.cipher.encryptJson(bundle)
    });
    await this.deps.repository.deleteGooglePending(scopedDb);
    return account;
  }

  async getFreshAccessToken(
    scopedDb: DataContextDb,
    opts: { force?: boolean } = {}
  ): Promise<string> {
    const stored = await this.deps.repository.getActiveGoogleAccountSecret(scopedDb);
    if (!stored) {
      throw new GoogleConnectError("No active Google connection");
    }
    const bundle = this.deps.cipher.decryptJson(stored.encryptedSecret) as GoogleConnectionSecret;
    // More than 60 s remaining — return the cached token without a network round-trip.
    // `force` (used by the sync 401-retry path) bypasses this fast path to force a refresh.
    if (!opts.force && new Date(bundle.tokenExpiry).getTime() - this.now().getTime() > 60_000) {
      return bundle.accessToken;
    }
    const refreshed = await this.deps.oauthClient.refreshAccessToken({
      clientId: bundle.clientId,
      clientSecret: bundle.clientSecret,
      refreshToken: bundle.refreshToken
    });
    const nextExpiry = new Date(this.now().getTime() + refreshed.expires_in * 1000).toISOString();
    await this.deps.repository.upsertGoogleAccount(scopedDb, {
      scopes: bundle.grantedScopes,
      encryptedSecret: this.deps.cipher.encryptJson({
        ...bundle,
        accessToken: refreshed.access_token,
        tokenExpiry: nextExpiry
      })
    });
    return refreshed.access_token;
  }
}
