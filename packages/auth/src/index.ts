import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { genericOAuth, type GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { sql, type Kysely } from "kysely";
import pg from "pg";

import {
  AuthSessionResolver,
  getJarvisDatabaseUrls,
  type AccessContext,
  type DataContextRunner,
  type JarvisDatabase
} from "@jarv1s/db";
import { recordBootstrapOwnerAuditEvent as settingsRecordBootstrapOwnerAuditEvent } from "@jarv1s/settings";
import type { AuthProviderStatusDto } from "@jarv1s/shared";

const { Pool } = pg;

export interface AuthenticatedPrincipal {
  readonly userId: string;
}

export interface RequestAccessContextInput {
  readonly id?: string;
  readonly headers: Headers | IncomingHttpHeaders;
}

export class AccountPendingApprovalError extends Error {
  readonly code = "account_pending_approval";
  constructor() {
    super("Account is pending approval");
  }
}

export class AccountDeactivatedError extends Error {
  readonly code = "account_deactivated";
  constructor() {
    super("Account has been deactivated");
  }
}

export interface JarvisAuthRuntime {
  readonly auth: ReturnType<typeof betterAuth>;
  readonly resolveAccessContext: (request: RequestAccessContextInput) => Promise<AccessContext>;
  readonly listConfiguredProviders: () => readonly AuthProviderStatusDto[];
  readonly revokeUserSessions: (userId: string) => Promise<number>;
  readonly close: () => Promise<void>;
}

/**
 * Minimal structured-log sink for security-relevant auth events. Shaped like a pino
 * logger's `info(mergeObject, msg)` so the Fastify request logger satisfies it directly,
 * without dragging a Fastify type dependency into the auth package. Optional: when absent
 * (e.g. tests that inject their own runtime) the events are simply not emitted.
 */
export interface AuthLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

export interface CreateJarvisAuthRuntimeOptions {
  readonly appDb: Kysely<JarvisDatabase>;
  readonly runner: DataContextRunner;
  readonly connectionString?: string;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Structured-log sink for the legacy session-bearer observability event (#113).
   * Pass the Fastify `server.log` here; omit to suppress the event.
   */
  readonly logger?: AuthLogger;
}

interface BetterAuthUser {
  readonly id: string;
  readonly email: string;
  readonly name?: string;
}

// The slice of the @jarv1s/settings public API that auth depends on. Auth records
// admin audit events exclusively through this public API, never through the settings
// repository class or by writing the settings-owned audit table directly (#101).
type BootstrapSettings = {
  readonly recordBootstrapOwnerAuditEvent: typeof settingsRecordBootstrapOwnerAuditEvent;
};

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
  const auth = betterAuth(
    createBetterAuthOptions(pool, options.appDb, env, options.runner, {
      recordBootstrapOwnerAuditEvent: settingsRecordBootstrapOwnerAuditEvent
    })
  );

  return {
    auth,
    resolveAccessContext: (request) =>
      resolveRequestAccessContext({
        request,
        auth,
        legacySessions,
        appDb: options.appDb,
        logger: options.logger
      }),
    listConfiguredProviders: () => listConfiguredAuthProviders(env),
    revokeUserSessions: async (userId: string) => {
      const result = await pool.query("DELETE FROM app.better_auth_sessions WHERE user_id = $1", [
        userId
      ]);
      return result.rowCount ?? 0;
    },
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
  env: NodeJS.ProcessEnv,
  runner: DataContextRunner,
  settings: BootstrapSettings
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
          before: (user) => registrationGate(appDb, user),
          after: (user) => bootstrapFirstJarvisUser(runner, settings, user as BetterAuthUser)
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
  readonly appDb: Kysely<JarvisDatabase>;
  readonly logger?: AuthLogger;
}): Promise<AccessContext> {
  const requestId = options.request.id ?? randomUUID();
  const headers = toWebHeaders(options.request.headers);
  const bearerToken = readBearerToken(headers);

  let actorUserId: string;

  if (bearerToken) {
    // LEGACY SESSION-BEARER PATH (#113 — hardened, do not weaken).
    //
    // This is the programmatic/headless auth used by the Jarv1s CLI bridge and the
    // integration suite. The bearer token IS a Better Auth session UUID — there is no
    // separate API-key table; the session id is the only secret. The following
    // invariants make this path safe to keep and MUST hold:
    //   1. expires_at is enforced *server-side*: `app.resolve_auth_session` filters
    //      `WHERE id = $1 AND expires_at > now()` (migration 0046). An expired session
    //      id cannot authenticate here — do not move that check into application code.
    //   2. The `::uuid` cast in the resolver rejects any non-UUID token (no SQL
    //      injection surface); `readBearerToken` already rejects malformed schemes.
    //   3. Use is observable: every successful bearer auth emits the structured event
    //      below so this weaker-than-cookie path is never silent.
    //   4. Use is throttled: bearer-authed routes carry the global rate-limit class
    //      keyed on the auth principal (apps/api/src/server.ts), not just IP.
    // The raw token is a session secret and MUST NEVER be logged (hard invariant —
    // session tokens never reach logs); only a one-way fingerprint is emitted.
    const ctx = await options.legacySessions.resolveAccessContext(bearerToken, requestId);
    actorUserId = ctx.actorUserId;
    options.logger?.info(
      {
        event: "auth.bearer_session",
        actorUserId,
        requestId,
        tokenFingerprint: fingerprintToken(bearerToken)
      },
      "Authenticated via legacy session-bearer token"
    );
  } else {
    const session = await options.auth.api.getSession({ headers });
    if (!session) {
      throw new Error("Session is missing or expired");
    }
    actorUserId = session.user.id;
  }

  const rows = await sql<{ status: string }>`
    SELECT status FROM app.get_user_by_id(${actorUserId}::uuid)
  `.execute(options.appDb);

  const userRow = rows.rows[0];
  if (!userRow) {
    throw new Error("Session is missing or expired");
  }
  if (userRow.status === "pending") {
    throw new AccountPendingApprovalError();
  }
  if (userRow.status === "deactivated") {
    throw new AccountDeactivatedError();
  }

  return { actorUserId, requestId };
}

async function registrationGate(
  appDb: Kysely<JarvisDatabase>,
  _user: BetterAuthUser
): Promise<void> {
  const countResult = await sql<{ count: string }>`SELECT app.count_all_users() AS count`.execute(
    appDb
  );
  const existingCount = Number(countResult.rows[0]?.count ?? 0);
  if (existingCount === 0) return;

  const enabled = await readBooleanSetting(appDb, "registration.enabled", true);
  if (!enabled) {
    throw new APIError("FORBIDDEN", {
      message: "Registration is disabled",
      code: "registration_disabled"
    });
  }
}

/**
 * Allowlist of NON-SECRET instance-config keys this pre-auth helper may read via the
 * raw appDb handle with no actor GUC (the documented "pre-auth non-secret
 * instance-config reads" exemption — see DEVELOPMENT_STANDARDS.md). Mechanically
 * bounds the exemption so the helper can never be repurposed to read an arbitrary
 * (possibly sensitive) setting key; mirrors PREAUTH_READABLE_SETTING_KEYS in
 * module-registry's chat-multiplexer boot reader. Secrets never live in
 * instance_settings (they are AES-256-GCM in the credential store), so this list
 * must only ever contain non-secret config keys.
 */
const PREAUTH_READABLE_SETTING_KEYS = new Set<string>([
  "registration.enabled",
  "registration.requires_approval"
]);

async function readBooleanSetting(
  appDb: Kysely<JarvisDatabase>,
  key: string,
  defaultValue: boolean
): Promise<boolean> {
  if (!PREAUTH_READABLE_SETTING_KEYS.has(key)) {
    throw new Error(`pre-auth instance-setting read not allowed for key "${key}"`);
  }
  const row = await appDb
    .selectFrom("app.instance_settings")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();

  if (!row) return defaultValue;
  const parsed = row.value as Record<string, unknown>;
  return typeof parsed.value === "boolean" ? parsed.value : defaultValue;
}

async function bootstrapFirstJarvisUser(
  runner: DataContextRunner,
  settings: BootstrapSettings,
  user: BetterAuthUser
): Promise<void> {
  // withDataContext is the sole transaction boundary: it opens one transaction and
  // sets app.actor_user_id / app.request_id GUCs for its lifetime. No raw appDb DML
  // and no manual set_config here (#127).
  await runner.withDataContext(
    { actorUserId: user.id, requestId: `bootstrap:${user.id}` },
    async (scopedDb) => {
      // Advisory transaction-level lock — prevents two concurrent sign-ups from both
      // seeing isFirstUser = true. Must run inside the same transaction.
      await sql`SELECT pg_advisory_xact_lock(hashtext('jarv1s:first-user-bootstrap'))`.execute(
        scopedDb.db
      );

      // app.count_all_users() is a SECURITY DEFINER function owned by jarvis_auth_runtime,
      // which has a USING(true) policy on users under FORCE RLS. This gives an accurate
      // total count even though app_runtime's own self-row policy would return count=1.
      const countResult = await sql<{
        count: string;
      }>`SELECT app.count_all_users() AS count`.execute(scopedDb.db);
      const isFirstUser = Number(countResult.rows[0]?.count ?? 0) === 1;

      let status: "active" | "pending" = "active";
      if (!isFirstUser) {
        const requiresApproval = await readBooleanSetting(
          scopedDb.db,
          "registration.requires_approval",
          true
        );
        if (requiresApproval) status = "pending";
      }

      await scopedDb.db
        .updateTable("app.users")
        .set({
          name: user.name ?? "",
          email: user.email,
          is_instance_admin: isFirstUser,
          is_bootstrap_owner: isFirstUser,
          status,
          updated_at: new Date()
        })
        .where("id", "=", user.id)
        .execute();

      if (!isFirstUser) {
        return;
      }

      // Auth must not write the settings-owned audit table directly. Record the
      // bootstrap event through the @jarv1s/settings SECURITY DEFINER helper (#122).
      await settings.recordBootstrapOwnerAuditEvent(scopedDb, {
        actorUserId: user.id,
        targetUserId: user.id,
        requestId: `bootstrap:${user.id}`
      });
    }
  );
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

// One-way fingerprint of a bearer/session token for observability. Returns a short
// SHA-256 prefix so a security log can correlate repeated use of the *same* token
// without ever recording the token itself (session tokens must never reach logs).
function fingerprintToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function readBearerToken(headers: Headers): string | undefined {
  const authorization = readHeader(headers, "authorization");

  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);

  // Total: anything that is not a well-formed `Bearer <token>` (wrong scheme, missing space,
  // empty token) yields `undefined` so the request falls through to cookie auth or produces a
  // single clean 401 — never a thrown control-flow error for a mere header-format failure.
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }

  return token;
}

function readHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);

  return value?.trim() || undefined;
}

// Fixed secret used ONLY under the test runner so suites that don't set
// BETTER_AUTH_SECRET get a stable signing key within and across runs. Gated
// strictly behind an explicit test signal — never behind "not production" —
// so it can never sign a real session.
const TEST_AUTH_SECRET = "jarv1s-test-better-auth-secret";

function isTestRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.VITEST === "true" || env.NODE_ENV === "test";
}

// Resolves the better-auth session-signing secret. A known/hardcoded constant
// must NEVER sign a real session, so the resolution order is:
//   1. BETTER_AUTH_SECRET / AUTH_SECRET from the environment — always preferred.
//   2. Test runner (VITEST / NODE_ENV=test) — a fixed test secret, gated behind
//      an explicit test signal only.
//   3. Production — FAIL FAST. A real deployment must provide its own secret.
//   4. Otherwise (local dev) — a strong, ephemeral per-process secret generated
//      at boot. This keeps headless LAN dev frictionless (no required env var to
//      start) while ensuring sessions are signed with a cryptographically-random
//      key, not a publicly-known constant. The trade-off is that sessions do not
//      survive a process restart in dev, which is acceptable; set
//      BETTER_AUTH_SECRET to make dev sessions durable.
function readAuthSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.BETTER_AUTH_SECRET ?? env.AUTH_SECRET;

  if (secret) {
    return secret;
  }

  if (isTestRuntime(env)) {
    return TEST_AUTH_SECRET;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is required in production");
  }

  const ephemeralSecret = randomBytes(32).toString("hex");
  console.warn(
    "[auth] BETTER_AUTH_SECRET is not set. Generated a strong EPHEMERAL " +
      "session-signing secret for this process. All sessions will be invalidated " +
      "when the process restarts. Set BETTER_AUTH_SECRET to persist sessions."
  );
  return ephemeralSecret;
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
