import { createHash } from "node:crypto";

import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sql, type Kysely } from "kysely";
import type { PgBoss } from "pg-boss";

import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";
import {
  DataContextRunner,
  createDatabase,
  getJarvisDatabaseUrls,
  type JarvisDatabase
} from "@jarv1s/db";
import { createPgBossClient } from "@jarv1s/jobs";
import {
  getBuiltInModuleManifests,
  registerBuiltInApiRoutes,
  type ChatEngineFactory
} from "@jarv1s/module-registry";
import { listModulesRouteSchema, parsePositiveIntEnv, type ModuleDto } from "@jarv1s/shared";

export interface CreateApiServerOptions {
  readonly appDb?: Kysely<JarvisDatabase>;
  readonly boss?: PgBoss;
  readonly authRuntime?: JarvisAuthRuntime;
  readonly logger?: boolean;
  /** Override the live-chat engine factory (tests inject a fake); defaults to real tmux. */
  readonly chatEngineFactory?: ChatEngineFactory;
}

export function createApiServer(options: CreateApiServerOptions = {}) {
  const appDb =
    options.appDb ??
    createDatabase({
      connectionString: getJarvisDatabaseUrls().app,
      maxConnections: Number(process.env.JARVIS_API_DB_POOL_SIZE ?? 4)
    });
  const boss = options.boss ?? createPgBossClient(getJarvisDatabaseUrls().app);
  const ownsAppDb = options.appDb === undefined;
  const ownsBoss = options.boss === undefined;
  const dataContext = new DataContextRunner(appDb);
  const server = Fastify({
    logger: options.logger ?? true,
    // Honor XFF only when an explicit opt-in confirms a trusted reverse proxy is in
    // front. Without this, XFF is attacker-controlled and must not key the rate limiter.
    trustProxy: !!process.env.JARVIS_TRUST_PROXY
  });
  const authRuntime =
    options.authRuntime ??
    createJarvisAuthRuntime({
      appDb,
      runner: dataContext,
      // Surfaces the legacy session-bearer observability event (#113) into the API logs.
      logger: server.log
    });
  const ownsAuthRuntime = options.authRuntime === undefined;
  const AUTH_MAX = parsePositiveIntEnv(process.env.JARVIS_RL_AUTH_MAX, 10);

  // Security headers via @fastify/helmet.
  // This API serves JSON only, so CSP is maximally restrictive (default-src 'none').
  // HSTS is omitted on plain HTTP — the header has no effect and misleads LAN/dev
  // setups where TLS is not present. It is enabled only when JARVIS_TRUST_PROXY is
  // set, which signals a TLS-terminating reverse proxy is in front (the same signal
  // already used for XFF trust above).
  server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    // X-Frame-Options is redundant when frame-ancestors is set in CSP, but helmet
    // sets it to DENY by default, which is a safe belt-and-suspenders header for
    // older browsers.
    frameguard: { action: "deny" },
    // noSniff: true is the helmet default (X-Content-Type-Options: nosniff).
    // referrerPolicy: no-referrer keeps request metadata off third-party servers.
    referrerPolicy: { policy: "no-referrer" },
    // Only activate HSTS when we know TLS is in use. Without TLS the header is
    // not just useless — it can lock users out of plain-HTTP LAN access.
    hsts: process.env.JARVIS_TRUST_PROXY
      ? {
          maxAge: 31536000,
          includeSubDomains: true
        }
      : false
  });

  // Register rate-limit first, then register all routes inside server.after() so the
  // plugin's onRoute hook is active when routes are added (Fastify defers plugin init
  // to ready(), so after() guarantees plugin-before-route ordering).
  //
  // This is a GLOBAL throttle class keyed on the presented principal (#113). Before the fix,
  // rate limiting was opt-in per-route (global:false) and keyed only on IP, so the legacy
  // session-bearer path — any caller presenting a session UUID as a bearer token — could
  // hammer arbitrary module routes unbounded; only the /api/auth/* credential POSTs were
  // throttled. Now every route that does NOT declare its own config.rateLimit inherits this
  // default per-principal limit: a leaked or abused bearer token is bounded to
  // JARVIS_RL_GLOBAL_MAX req/min on its own (UUID-keyed) bucket.
  //
  // Routes with their own config.rateLimit OVERRIDE this (they do not stack): chat / MCP /
  // AI-tools keep their stricter per-principal limits, and /api/auth/* pins its own IP-based
  // key (credential POSTs are pre-auth — see registerBetterAuthRoutes). Health probes are
  // exempt via allowList.
  const GLOBAL_RL_MAX = parsePositiveIntEnv(process.env.JARVIS_RL_GLOBAL_MAX, 2000);
  server.register(rateLimit, {
    global: true,
    max: GLOBAL_RL_MAX,
    timeWindow: "1 minute",
    // Health/readiness probes must never be throttled (monitoring + compose smoke).
    allowList: (request) => request.url === "/health" || request.url.startsWith("/health/ready"),
    keyGenerator: authPrincipalRateLimitKey
  });

  server.after(() => {
    server.get("/health", async () => ({ ok: true }));

    server.get("/health/ready", async (_, reply) => {
      let dbStatus = "ok";
      let pgbossStatus = "ok";

      try {
        await sql`SELECT 1`.execute(appDb);
      } catch {
        dbStatus = "down";
      }

      try {
        const installed = await boss.isInstalled();
        if (!installed) {
          pgbossStatus = "down";
        }
      } catch {
        pgbossStatus = "down";
      }

      const healthy = dbStatus === "ok" && pgbossStatus === "ok";
      return reply
        .code(healthy ? 200 : 503)
        .send({ ok: healthy, db: dbStatus, pgboss: pgbossStatus });
    });

    registerBetterAuthRoutes(server, authRuntime, AUTH_MAX);
    registerPlatformRoutes(server, authRuntime);

    registerBuiltInApiRoutes(server, {
      rootDb: appDb,
      resolveAccessContext: authRuntime.resolveAccessContext,
      listConfiguredAuthProviders: authRuntime.listConfiguredProviders,
      listModuleManifests: getBuiltInModuleManifests,
      dataContext,
      boss,
      chatEngineFactory: options.chatEngineFactory,
      revokeUserSessions: authRuntime.revokeUserSessions,
      bootstrapConnectionString: ownsAppDb ? getJarvisDatabaseUrls().bootstrap : undefined
    });
  });

  server.addHook("onReady", async () => {
    if (ownsBoss) {
      await boss.start();
    }
  });

  server.addHook("onClose", async () => {
    await Promise.allSettled([
      ownsBoss ? boss.stop({ graceful: false }) : Promise.resolve(),
      ownsAuthRuntime ? authRuntime.close() : Promise.resolve(),
      ownsAppDb ? appDb.destroy() : Promise.resolve()
    ]);
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createApiServer();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  const handleCrash = (label: string, err: unknown): void => {
    server.log.error({ err, label }, "Process crash — exiting");
    const drain = Promise.race([
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 2000);
      })
    ]);
    void drain.then(() => {
      process.exit(1);
    });
  };

  process.on("unhandledRejection", (reason) => {
    handleCrash("unhandledRejection", reason);
  });
  process.on("uncaughtException", (err: Error) => {
    handleCrash("uncaughtException", err);
  });

  await server.listen({ host, port });
}

// Credential POST paths that must be throttled.
// `sign-in/social` initiates an OAuth flow (the provider is carried in the request body,
// not the path) and is an abuse-prone unauthenticated surface, so it is throttled too
// (OTNR-P4 #122). The OAuth *callback* (`/api/auth/callback/:provider`) is a provider-driven
// GET redirect — it is intentionally NOT throttled: it is exempted by the POST-only guard
// below, carries a per-flow state token better-auth already validates, and rate-limiting a
// provider redirect would break legitimate logins.
const THROTTLED_AUTH_PATHS = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/sign-in/social",
  "/api/auth/sign-up/email",
  "/api/auth/forget-password",
  "/api/auth/reset-password",
  "/api/auth/change-password"
]);

// Better Auth session-token cookie names. The `__Secure-` prefix is added automatically
// when the cookie is issued over TLS (which the app does behind JARVIS_TRUST_PROXY), so a
// browser user's request carries the prefixed form. Both must be recognized or TLS users
// silently degrade from a per-principal bucket to a shared per-IP one.
const SESSION_COOKIE_NAMES = ["better-auth.session_token=", "__Secure-better-auth.session_token="];

// A Better Auth session id is a v4 UUID (the legacy session-bearer path casts it ::uuid).
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rate-limit key for the global throttle class. Prefer the presented credential so each
// LAN user / bearer client gets its own bucket; otherwise key on the real peer IP.
//
// Junk credentials must NOT mint fresh buckets, or an attacker varying a bogus token per
// request would evade the per-principal limit entirely (each bogus token = a new 2000/min
// bucket = unbounded resolve_auth_session DB load). So the bearer branch keys per-principal
// ONLY for a UUID-shaped token (the sole shape the legacy session-bearer path can resolve);
// anything else falls through to the peer-IP bucket, which is bounded. The cookie value is
// opaque/signed so a non-empty value is treated as a principal as-is.
//
// The token/cookie is a session secret, so it is hashed — never used raw as a key — keeping
// it out of the limiter's in-memory store and any error/header output. Namespaced prefixes
// prevent a bearer hash from ever colliding with a cookie hash or an IP literal.
function authPrincipalRateLimitKey(request: FastifyRequest): string {
  const authorization = request.headers.authorization ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(authorization.indexOf(" ") + 1).trim();
    if (token && SESSION_UUID.test(token)) {
      return `bearer:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
    }
  }

  const cookieParts = (request.headers.cookie ?? "").split(";").map((part) => part.trim());
  for (const name of SESSION_COOKIE_NAMES) {
    const match = cookieParts.find((part) => part.startsWith(name));
    if (match) {
      const value = match.slice(name.length).split(";")[0];
      if (value) {
        return `cookie:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
      }
    }
  }

  // When JARVIS_TRUST_PROXY is set, Fastify resolves request.ip from the XFF chain after
  // verifying the proxy; otherwise it is the socket remote address and client-supplied
  // XFF headers are ignored (C1 regression guard).
  return `ip:${request.ip}`;
}

function registerBetterAuthRoutes(
  server: FastifyInstance,
  authRuntime: JarvisAuthRuntime,
  authMax: number
): void {
  server.route({
    method: ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"],
    url: "/api/auth/*",
    config: {
      rateLimit: {
        max: authMax,
        timeWindow: "1 minute",
        // Credential POSTs are PRE-auth: there is no trusted principal yet, and the
        // Authorization/Cookie headers are fully attacker-controlled. Key on the peer IP
        // (C1 decision). This MUST be set explicitly: a per-route config.rateLimit with no
        // keyGenerator inherits the GLOBAL keyGenerator (authPrincipalRateLimitKey), which
        // would let an attacker vary `Authorization: Bearer <junk-N>` to mint a fresh bucket
        // per request and fully bypass the sign-in brute-force throttle (OTNR-P4 #122 / C1).
        keyGenerator: (req: FastifyRequest) => `ip:${req.ip}`,
        allowList: (req: FastifyRequest) => {
          if (req.method !== "POST") return true;
          // Decode percent-encoded path before matching to close the %65mail bypass.
          // Malformed sequences fall back to the raw pathname — not in the set → throttled.
          const raw = new URL(req.url, "http://localhost").pathname;
          let pathname: string;
          try {
            pathname = decodeURIComponent(raw);
          } catch {
            pathname = raw;
          }
          return !THROTTLED_AUTH_PATHS.has(pathname);
        }
      }
    },
    handler: (request, reply) => handleBetterAuthRequest(request, reply, authRuntime)
  });
}

function registerPlatformRoutes(server: FastifyInstance, authRuntime: JarvisAuthRuntime): void {
  server.get("/api/modules", { schema: listModulesRouteSchema }, async (request, reply) => {
    try {
      await authRuntime.resolveAccessContext(request);

      return {
        modules: getBuiltInModuleManifests().map(serializeModule)
      };
    } catch (error) {
      const code =
        (error instanceof Error && (error as Error & { code?: string }).code) || undefined;
      if (code === "account_pending_approval" || code === "account_deactivated") {
        return reply.code(403).send({ error: (error as Error).message, code });
      }
      return reply.code(401).send({ error: "Session is missing or expired" });
    }
  });
}

function serializeModule(module: ReturnType<typeof getBuiltInModuleManifests>[number]): ModuleDto {
  return {
    id: module.id,
    name: module.name,
    version: module.version,
    lifecycle: module.lifecycle,
    navigation: (module.navigation ?? []).map((entry) => ({
      id: entry.id,
      label: entry.label,
      path: entry.path,
      icon: entry.icon ?? null,
      order: entry.order ?? null
    })),
    settings: (module.settings ?? []).map((surface) => ({
      id: surface.id,
      label: surface.label,
      path: surface.path,
      scope: surface.scope,
      order: surface.order ?? null
    }))
  };
}

async function handleBetterAuthRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  authRuntime: JarvisAuthRuntime
) {
  const response = await authRuntime.auth.handler(toWebRequest(request));

  reply.code(response.status);
  for (const [name, value] of response.headers.entries()) {
    if (name.toLowerCase() === "set-cookie" || name.toLowerCase() === "content-length") {
      continue;
    }
    reply.header(name, value);
  }

  const setCookieHeaders = readSetCookieHeaders(response.headers);
  if (setCookieHeaders.length > 0) {
    reply.header("set-cookie", setCookieHeaders);
  }

  const body = Buffer.from(await response.arrayBuffer());

  return body.length > 0 ? reply.send(body) : reply.send();
}

function toWebRequest(request: FastifyRequest): Request {
  const headers = toWebHeaders(request.headers);
  // Build the better-auth URL from Fastify's protocol/host, which already honor the
  // explicit `trustProxy` opt-in (JARVIS_TRUST_PROXY): forwarded headers are consulted
  // only when a trusted proxy is configured, and otherwise fall back to the connection
  // scheme/host. Reading x-forwarded-proto / host directly off client headers would
  // trust attacker-controlled values regardless of that opt-in (#164).
  const protocol = request.protocol;
  const host = request.host || "localhost:3000";
  const url = `${protocol}://${host}${request.url}`;
  const init: RequestInit = {
    method: request.method,
    headers
  };

  if (request.method !== "GET" && request.method !== "HEAD" && request.body !== undefined) {
    init.body = encodeBody(request.body);
  }

  return new Request(url, init);
}

function toWebHeaders(headers: FastifyRequest["headers"]): Headers {
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
    webHeaders.set(name, String(value));
  }

  return webHeaders;
}

function encodeBody(body: unknown): BodyInit {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);

    return copy.buffer;
  }

  return JSON.stringify(body);
}

function readSetCookieHeaders(headers: Headers): string[] {
  const headerWithSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };

  return headerWithSetCookie.getSetCookie?.() ?? [];
}
