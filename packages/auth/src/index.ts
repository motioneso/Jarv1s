import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { genericOAuth, type GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { sql, type Kysely } from "kysely";
import pg from "pg";

import {
  AuthSessionResolver,
  getJarvisDatabaseUrls,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import type { AuthProviderStatusDto } from "@jarv1s/shared";

const { Pool } = pg;

export interface AuthenticatedPrincipal {
  readonly userId: string;
}

export interface RequestAccessContextInput {
  readonly id?: string;
  readonly headers: Headers | IncomingHttpHeaders;
}

export interface JarvisAuthRuntime {
  readonly auth: ReturnType<typeof betterAuth>;
  readonly resolveAccessContext: (request: RequestAccessContextInput) => Promise<AccessContext>;
  readonly listConfiguredProviders: () => readonly AuthProviderStatusDto[];
  readonly close: () => Promise<void>;
}

export interface CreateJarvisAuthRuntimeOptions {
  readonly appDb: Kysely<JarvisDatabase>;
  readonly connectionString?: string;
  readonly env?: NodeJS.ProcessEnv;
}

interface BetterAuthUser {
  readonly id: string;
  readonly email: string;
  readonly name?: string;
}

export function createJarvisAuthRuntime(
  options: CreateJarvisAuthRuntimeOptions
): JarvisAuthRuntime {
  const env = options.env ?? process.env;
  const pool = new Pool({
    connectionString: options.connectionString ?? getJarvisDatabaseUrls(env).auth,
    max: Number(env.JARVIS_AUTH_DB_POOL_SIZE ?? 4),
    options: "-c search_path=app,public"
  });
  const legacySessions = new AuthSessionResolver(options.appDb);
  const auth = betterAuth(createBetterAuthOptions(pool, options.appDb, env));

  return {
    auth,
    resolveAccessContext: (request) =>
      resolveRequestAccessContext({
        request,
        auth,
        legacySessions
      }),
    listConfiguredProviders: () => listConfiguredAuthProviders(env),
    close: () => pool.end()
  };
}

export function listConfiguredAuthProviders(
  env: NodeJS.ProcessEnv = process.env
): readonly AuthProviderStatusDto[] {
  return [
    {
      id: "email-password",
      displayName: "Email and password",
      providerType: "local",
      enabled: true
    },
    {
      id: "google",
      displayName: "Google",
      providerType: "oauth",
      enabled: hasCredentialPair(
        env,
        "JARVIS_AUTH_GOOGLE_CLIENT_ID",
        "JARVIS_AUTH_GOOGLE_CLIENT_SECRET"
      )
    },
    {
      id: "github",
      displayName: "GitHub",
      providerType: "oauth",
      enabled: hasCredentialPair(
        env,
        "JARVIS_AUTH_GITHUB_CLIENT_ID",
        "JARVIS_AUTH_GITHUB_CLIENT_SECRET"
      )
    },
    {
      id: "microsoft",
      displayName: "Microsoft",
      providerType: "oauth",
      enabled: hasCredentialPair(
        env,
        "JARVIS_AUTH_MICROSOFT_CLIENT_ID",
        "JARVIS_AUTH_MICROSOFT_CLIENT_SECRET"
      )
    },
    {
      id: readString(env, "JARVIS_AUTH_OIDC_PROVIDER_ID") ?? "oidc",
      displayName: readString(env, "JARVIS_AUTH_OIDC_DISPLAY_NAME") ?? "Generic OIDC",
      providerType: "oidc",
      enabled: hasOidcProviderConfig(env)
    }
  ];
}

function createBetterAuthOptions(
  pool: pg.Pool,
  appDb: Kysely<JarvisDatabase>,
  env: NodeJS.ProcessEnv
): BetterAuthOptions {
  const socialProviders = readSocialProviders(env);
  const plugins = readAuthPlugins(env);

  return {
    appName: "Jarv1s",
    basePath: "/api/auth",
    baseURL: env.JARVIS_AUTH_BASE_URL ?? env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: readAuthSecret(env),
    database: pool,
    emailAndPassword: {
      enabled: true
    },
    user: {
      modelName: "users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at"
      },
      additionalFields: {
        isInstanceAdmin: {
          type: "boolean",
          fieldName: "is_instance_admin",
          required: true,
          input: false,
          defaultValue: false
        }
      }
    },
    session: {
      modelName: "better_auth_sessions",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id"
      }
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at"
      }
    },
    verification: {
      modelName: "auth_verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at"
      }
    },
    advanced: {
      database: {
        generateId: "uuid"
      }
    },
    databaseHooks: {
      user: {
        create: {
          after: (user) => bootstrapFirstJarvisUser(appDb, user)
        }
      }
    },
    trustedOrigins: readTrustedOrigins(env),
    ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
    ...(plugins.length > 0 ? { plugins } : {})
  };
}

async function resolveRequestAccessContext(options: {
  readonly request: RequestAccessContextInput;
  readonly auth: ReturnType<typeof betterAuth>;
  readonly legacySessions: AuthSessionResolver;
}): Promise<AccessContext> {
  const requestId = options.request.id ?? randomUUID();
  const headers = toWebHeaders(options.request.headers);
  const bearerToken = readBearerToken(headers);

  if (bearerToken) {
    return options.legacySessions.resolveAccessContext(bearerToken, requestId);
  }

  const session = await options.auth.api.getSession({ headers });

  if (!session) {
    throw new Error("Session is missing or expired");
  }

  return {
    actorUserId: session.user.id,
    requestId
  };
}

async function bootstrapFirstJarvisUser(
  appDb: Kysely<JarvisDatabase>,
  user: BetterAuthUser
): Promise<void> {
  await appDb.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtext('jarv1s:first-user-bootstrap'))`.execute(
      transaction
    );

    // app.count_all_users() is a SECURITY DEFINER function owned by jarvis_auth_runtime,
    // which has a USING(true) policy on users under FORCE RLS. This gives us an accurate
    // total count even though app_runtime's own self-row policy would return count=1.
    const countResult = await sql<{ count: string }>`SELECT app.count_all_users() AS count`.execute(
      transaction
    );
    const isFirstUser = Number(countResult.rows[0]?.count ?? 0) === 1;

    // Set actor GUC so the UPDATE passes the self-row policy on app.users.
    // The 'true' flag scopes this to the transaction only.
    await sql`SELECT set_config('app.actor_user_id', ${user.id}, true)`.execute(transaction);

    await transaction
      .updateTable("app.users")
      .set({
        name: user.name ?? "",
        email: user.email,
        is_instance_admin: isFirstUser,
        updated_at: new Date()
      })
      .where("id", "=", user.id)
      .execute();

    if (!isFirstUser) {
      return;
    }

    const workspaceId = randomUUID();

    await transaction
      .insertInto("app.workspaces")
      .values({
        id: workspaceId,
        name: "Personal",
        created_by_user_id: user.id,
        created_at: new Date(),
        updated_at: new Date()
      })
      .execute();
    await transaction
      .insertInto("app.workspace_memberships")
      .values({
        user_id: user.id,
        workspace_id: workspaceId,
        role: "owner",
        created_at: new Date()
      })
      .execute();

    await transaction
      .insertInto("app.admin_audit_events")
      .values({
        id: randomUUID(),
        actor_user_id: user.id,
        action: "bootstrap.instance_owner",
        target_type: "user",
        target_id: user.id,
        metadata: {
          workspaceId
        },
        request_id: null,
        created_at: new Date()
      })
      .execute();
  });
}

function toWebHeaders(headers: Headers | IncomingHttpHeaders): Headers {
  if (headers instanceof Headers) {
    return headers;
  }

  const webHeaders = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        webHeaders.append(name, item);
      }
      continue;
    }
    webHeaders.set(name, value);
  }

  return webHeaders;
}

function readBearerToken(headers: Headers): string | undefined {
  const authorization = readHeader(headers, "authorization");

  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new Error("Invalid bearer token");
  }

  return token;
}

function readHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);

  return value?.trim() || undefined;
}

function readAuthSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.BETTER_AUTH_SECRET ?? env.AUTH_SECRET;

  if (secret) {
    return secret;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is required in production");
  }

  return "jarv1s-development-better-auth-secret";
}

function readTrustedOrigins(env: NodeJS.ProcessEnv): string[] {
  return (env.JARVIS_AUTH_TRUSTED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function readSocialProviders(
  env: NodeJS.ProcessEnv
): NonNullable<BetterAuthOptions["socialProviders"]> {
  const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  const google = readCredentialPair(
    env,
    "JARVIS_AUTH_GOOGLE_CLIENT_ID",
    "JARVIS_AUTH_GOOGLE_CLIENT_SECRET"
  );
  const github = readCredentialPair(
    env,
    "JARVIS_AUTH_GITHUB_CLIENT_ID",
    "JARVIS_AUTH_GITHUB_CLIENT_SECRET"
  );
  const microsoft = readCredentialPair(
    env,
    "JARVIS_AUTH_MICROSOFT_CLIENT_ID",
    "JARVIS_AUTH_MICROSOFT_CLIENT_SECRET"
  );

  if (google) {
    socialProviders.google = {
      clientId: google.clientId,
      clientSecret: google.clientSecret
    };
  }
  if (github) {
    socialProviders.github = {
      clientId: github.clientId,
      clientSecret: github.clientSecret
    };
  }
  if (microsoft) {
    socialProviders.microsoft = {
      clientId: microsoft.clientId,
      clientSecret: microsoft.clientSecret,
      tenantId: readString(env, "JARVIS_AUTH_MICROSOFT_TENANT_ID") ?? "common",
      authority: readString(env, "JARVIS_AUTH_MICROSOFT_AUTHORITY")
    };
  }

  return socialProviders;
}

function readAuthPlugins(env: NodeJS.ProcessEnv): NonNullable<BetterAuthOptions["plugins"]> {
  const oidcConfig = readOidcProviderConfig(env);

  return oidcConfig ? [genericOAuth({ config: [oidcConfig] })] : [];
}

function readOidcProviderConfig(env: NodeJS.ProcessEnv): GenericOAuthConfig | undefined {
  const credentials = readCredentialPair(
    env,
    "JARVIS_AUTH_OIDC_CLIENT_ID",
    "JARVIS_AUTH_OIDC_CLIENT_SECRET"
  );
  const discoveryUrl = readString(env, "JARVIS_AUTH_OIDC_DISCOVERY_URL");

  if (!credentials && !discoveryUrl) {
    return undefined;
  }
  if (!credentials || !discoveryUrl) {
    throw new Error(
      "JARVIS_AUTH_OIDC_CLIENT_ID, JARVIS_AUTH_OIDC_CLIENT_SECRET, and JARVIS_AUTH_OIDC_DISCOVERY_URL must be configured together"
    );
  }

  return {
    providerId: readString(env, "JARVIS_AUTH_OIDC_PROVIDER_ID") ?? "oidc",
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    discoveryUrl,
    issuer: readString(env, "JARVIS_AUTH_OIDC_ISSUER"),
    requireIssuerValidation: readBoolean(env, "JARVIS_AUTH_OIDC_REQUIRE_ISSUER_VALIDATION"),
    scopes: ["openid", "email", "profile"],
    pkce: true
  };
}

function hasOidcProviderConfig(env: NodeJS.ProcessEnv): boolean {
  return (
    hasCredentialPair(env, "JARVIS_AUTH_OIDC_CLIENT_ID", "JARVIS_AUTH_OIDC_CLIENT_SECRET") &&
    readString(env, "JARVIS_AUTH_OIDC_DISCOVERY_URL") !== undefined
  );
}

function readCredentialPair(
  env: NodeJS.ProcessEnv,
  clientIdKey: string,
  clientSecretKey: string
): { readonly clientId: string; readonly clientSecret: string } | undefined {
  const clientId = readString(env, clientIdKey);
  const clientSecret = readString(env, clientSecretKey);

  if (!clientId && !clientSecret) {
    return undefined;
  }
  if (!clientId || !clientSecret) {
    throw new Error(`${clientIdKey} and ${clientSecretKey} must be configured together`);
  }

  return { clientId, clientSecret };
}

function hasCredentialPair(
  env: NodeJS.ProcessEnv,
  clientIdKey: string,
  clientSecretKey: string
): boolean {
  return readCredentialPair(env, clientIdKey, clientSecretKey) !== undefined;
}

function readString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();

  return value || undefined;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string): boolean | undefined {
  const value = readString(env, key);

  if (value === undefined) {
    return undefined;
  }
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }

  throw new Error(`${key} must be a boolean value`);
}
