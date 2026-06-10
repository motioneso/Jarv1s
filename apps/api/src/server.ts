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
import { listModulesRouteSchema, type ModuleDto } from "@jarv1s/shared";

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
  const authRuntime =
    options.authRuntime ??
    createJarvisAuthRuntime({
      appDb
    });
  const ownsAuthRuntime = options.authRuntime === undefined;
  const server = Fastify({
    logger: options.logger ?? true,
    // Honor XFF only when an explicit opt-in confirms a trusted reverse proxy is in
    // front. Without this, XFF is attacker-controlled and must not key the rate limiter.
    trustProxy: !!process.env.JARVIS_TRUST_PROXY
  });
  const dataContext = new DataContextRunner(appDb);
  const AUTH_MAX = Number(process.env.JARVIS_RL_AUTH_MAX ?? 10);

  // Register rate-limit first, then register all routes inside server.after() so the
  // plugin's onRoute hook is active when routes are added (Fastify defers plugin init
  // to ready(), so after() guarantees plugin-before-route ordering).
  server.register(rateLimit, {
    global: false,
    // Always key on the real peer IP. When JARVIS_TRUST_PROXY is set, Fastify resolves
    // request.ip from the XFF chain after verifying the proxy; otherwise it is the
    // socket remote address and client-supplied XFF headers are ignored.
    keyGenerator: (request) => request.ip
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
      appDb,
      resolveAccessContext: authRuntime.resolveAccessContext,
      listConfiguredAuthProviders: authRuntime.listConfiguredProviders,
      listModuleManifests: getBuiltInModuleManifests,
      dataContext,
      boss,
      chatEngineFactory: options.chatEngineFactory
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
const THROTTLED_AUTH_PATHS = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/sign-up/email",
  "/api/auth/forget-password",
  "/api/auth/reset-password",
  "/api/auth/change-password"
]);

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
    } catch {
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
  const protocol = readForwardedProtocol(headers);
  const host = headers.get("host") ?? "localhost:3000";
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

function readForwardedProtocol(headers: Headers): string {
  const value = headers.get("x-forwarded-proto");

  if (!value) {
    return "http";
  }

  return value.split(",", 1)[0]?.trim() || "http";
}

function readSetCookieHeaders(headers: Headers): string[] {
  const headerWithSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };

  return headerWithSetCookie.getSetCookie?.() ?? [];
}
