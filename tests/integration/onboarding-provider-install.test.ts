import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import { type Kysely } from "kysely";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  createDatabase,
  DataContextRunner,
  type AccessContext,
  type DataContextDb,
  type JarvisDatabase,
  type User
} from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import {
  registerOnboardingRoutes,
  SettingsRepository,
  type OnboardingProbes,
  type OnboardingRoutesDependencies
} from "@jarv1s/settings";
import type { RpcConnection } from "@jarv1s/chat";
import { buildOnboardingInstall } from "../../packages/module-registry/src/onboarding-install.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

// ---------------------------------------------------------------------------
// #342 §A.5 — exercises the REAL install seam wiring end-to-end against Postgres.
//
// Unlike the unit test (which injects a FAKE seam into the route and so CANNOT
// catch a composition-root wiring gap), this test wires the PRODUCTION
// `buildOnboardingInstall` over a fake `RpcConnection` and a REAL SettingsRepository
// against the real DB, behind the real `registerOnboardingRoutes`. It proves:
//   1. the install route triggers installProvider + persists `installing` BEFORE and
//      the terminal `installed` AFTER, writing REAL rows under the 0103 admin write RLS;
//   2. the status load reads `app.provider_install_state` and surfaces `installState`;
//   3. a STALE `installing` row (api crashed mid-install) is corrected (§A.4.2) on the
//      status load from a fresh probe and the corrected state is surfaced.
// ---------------------------------------------------------------------------

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

interface FakeRpc {
  installResult: {
    state: "installed" | "error";
    version?: string;
    message?: string;
    // #1081 H2: true ONLY on a real reinstall — see RpcInstallProviderResult.binaryChanged.
    binaryChanged?: boolean;
  };
  probeStatus: "ready" | "needs_login" | "not_installed" | "multiplexer_unavailable" | "error";
  installCalls: string[];
  probeCalls: string[];
}

function makeFakeConnection(state: FakeRpc): RpcConnection {
  return {
    installProvider: async ({ provider }: { provider: string }) => {
      state.installCalls.push(provider);
      return state.installResult;
    },
    probeProvider: async ({ provider }: { provider: string }) => {
      state.probeCalls.push(provider);
      return { status: state.probeStatus };
    }
  } as unknown as RpcConnection;
}

describe("Phase 2 onboarding — provider-install seam (REAL wiring)", () => {
  let bootstrapServer: ReturnType<typeof createApiServer>;
  let appDb: Kysely<JarvisDatabase>;
  let boss: PgBoss;
  let dataContext: DataContextRunner;
  let repository: SettingsRepository;
  let ownerUserId: string;
  let server: FastifyInstance;
  const fake: FakeRpc = {
    installResult: { state: "installed", version: "2.1.183" },
    probeStatus: "ready",
    installCalls: [],
    probeCalls: []
  };

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new SettingsRepository();

    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    // The first sign-up is the bootstrap owner / instance admin (the 0103 write-RLS actor).
    bootstrapServer = createApiServer({ appDb, boss, logger: false });
    await bootstrapServer.ready();
    const signUp = await bootstrapServer.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Owner",
        email: "owner@provider-install.test",
        password: "correct horse battery staple"
      }
    });
    void cookieHeader(signUp.headers);
    ownerUserId = signUp.json<{ user: { id: string } }>().user.id;

    // A bare server with the REAL onboarding routes + REAL install seam (production
    // buildOnboardingInstall) over a fake RpcConnection. resolveAccessContext yields the
    // bootstrap owner so writes run under the admin actor (0103 write RLS).
    const resolveAccessContext = async (_request: FastifyRequest): Promise<AccessContext> => ({
      actorUserId: ownerUserId,
      requestId: "req-install-test"
    });

    const onboardingInstall = buildOnboardingInstall({
      enabled: true,
      getConnection: () => makeFakeConnection(fake),
      repository
    });
    if (!onboardingInstall) throw new Error("seam must be built when enabled");

    const requireKnownUser = async (scopedDb: DataContextDb, userId: string): Promise<User> => {
      const user = await repository.getUserById(scopedDb, userId);
      if (!user) throw new HttpError(404, "User not found");
      return user;
    };
    const assertBootstrapOwnerAdminUser = async (
      scopedDb: DataContextDb,
      userId: string
    ): Promise<User> => {
      const user = await requireKnownUser(scopedDb, userId);
      if (!user.is_bootstrap_owner || !user.is_instance_admin) {
        throw new HttpError(403, "Bootstrap owner permission is required");
      }
      return user;
    };

    // Probes: cliPresent reflects the fake probe; the rest are inert for these tests.
    const probes: OnboardingProbes = {
      cliPresent: async () => fake.probeStatus !== "not_installed",
      testProviderConnection: async () => ({ status: fake.probeStatus }),
      connectorAccountExists: async () => false
    };

    const dependencies: OnboardingRoutesDependencies = {
      dataContext,
      resolveAccessContext,
      onboardingProbes: probes,
      repository,
      requireKnownUser,
      assertBootstrapOwnerAdminUser,
      requireRequestId: (ctx) => {
        if (!ctx.requestId) throw new HttpError(500, "Request id is missing");
        return ctx.requestId;
      },
      handleRouteError: (error, reply) => handleRouteError(error, reply),
      onboardingInstall
    };

    server = Fastify({ logger: false });
    registerOnboardingRoutes(server, dependencies);
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([
      server?.close(),
      bootstrapServer?.close(),
      appDb?.destroy(),
      boss?.stop({ graceful: false })
    ]);
  });

  async function readPersisted(provider: string) {
    return dataContext.withDataContext(
      { actorUserId: ownerUserId, requestId: "req-read" },
      (scopedDb) => repository.readProviderInstallState(scopedDb, provider as never)
    );
  }

  it("triggers installProvider and persists a REAL installed row under admin RLS", async () => {
    fake.installResult = { state: "installed", version: "2.1.183" };
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/provider-install",
      headers: { "content-type": "application/json" },
      payload: { providerKind: "anthropic" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      providerKind: "anthropic",
      installState: "installed",
      version: "2.1.183"
    });
    expect(fake.installCalls).toContain("anthropic");

    // The row actually landed in app.provider_install_state (the wiring gap would leave none).
    const row = await readPersisted("anthropic");
    expect(row).toMatchObject({ provider: "anthropic", state: "installed", version: "2.1.183" });
  });

  it("rejects a blocked provider (google/agy) with 400 and persists NOTHING", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/provider-install",
      headers: { "content-type": "application/json" },
      payload: { providerKind: "google" }
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/not installable/i);
    expect(await readPersisted("google")).toBeUndefined();
  });

  it("status load reads provider_install_state and surfaces installState", async () => {
    // anthropic was installed above ⇒ status must surface it.
    const res = await server.inject({ method: "GET", url: "/api/onboarding/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      steps: { cliAuth: { providers: { kind: string; installState?: string }[] } };
    };
    const anthropic = body.steps.cliAuth.providers.find((p) => p.kind === "anthropic");
    expect(anthropic?.installState).toBe("installed");
  });

  it("corrects a STALE `installing` row on the status load (§A.4.2) from a fresh probe", async () => {
    // Persist a stale `installing` row directly (simulating an api crash mid-install).
    await dataContext.withDataContext(
      { actorUserId: ownerUserId, requestId: "req-seed-stale" },
      (scopedDb) =>
        repository.upsertProviderInstallState(scopedDb, {
          provider: "openai-compatible",
          state: "installing"
        })
    );

    // A fresh probe that reports the binary present ⇒ the projection corrects to `installed`.
    fake.probeStatus = "ready";
    fake.probeCalls = [];
    const res = await server.inject({ method: "GET", url: "/api/onboarding/status" });
    expect(res.statusCode).toBe(200);
    // v0.1.3 F2: codex/openai-compatible is HIDDEN from the onboarding cliAuth providers list
    // (presentation allowlist), so it is NOT surfaced here. The install-seam RECONCILE still runs
    // server-side for every provider, so assert on the probe + the PERSISTED correction instead.
    const body = res.json() as {
      steps: { cliAuth: { providers: { kind: string }[] } };
    };
    expect(body.steps.cliAuth.providers.some((p) => p.kind === "openai-compatible")).toBe(false);
    // The reconcile probed the stale provider...
    expect(fake.probeCalls).toContain("openai-compatible");
    // ...and PERSISTED the correction (no longer stale on the next read).
    expect(await readPersisted("openai-compatible")).toMatchObject({ state: "installed" });
  });

  it("leaves a stale `installing` row UNCHANGED when the probe is untrusted (transient)", async () => {
    await dataContext.withDataContext(
      { actorUserId: ownerUserId, requestId: "req-seed-stale2" },
      (scopedDb) =>
        repository.upsertProviderInstallState(scopedDb, {
          provider: "openai-compatible",
          state: "installing"
        })
    );
    // A transient multiplexer_unavailable probe ⇒ leave `installing` (do not downgrade).
    fake.probeStatus = "multiplexer_unavailable";
    const res = await server.inject({ method: "GET", url: "/api/onboarding/status" });
    expect(res.statusCode).toBe(200);
    // v0.1.3 F2: codex is hidden from the surfaced providers; the reconcile still runs, so assert
    // the PERSISTED row was left untouched (not downgraded) rather than the hidden surface field.
    const body = res.json() as {
      steps: { cliAuth: { providers: { kind: string }[] } };
    };
    expect(body.steps.cliAuth.providers.some((p) => p.kind === "openai-compatible")).toBe(false);
    expect(await readPersisted("openai-compatible")).toMatchObject({ state: "installing" });
  });
});

// ---------------------------------------------------------------------------
// #1081 H2 — proves the REAL `buildOnboardingInstall` wiring both forwards
// `binaryChanged` through to the route response AND triggers the injected
// `dropSessionsForProvider` seam exactly when a real reinstall replaced the binary
// (`binaryChanged: true`), never on an idempotent no-op (`false`/absent). The unit test
// for `onboarding-routes.ts` covers the fast-json-stringify schema trap for `binaryChanged`
// in isolation; this test proves the PRODUCTION composition root (module-registry's
// `buildOnboardingInstall`) actually calls the seam, which a route-level fake cannot catch.
// ---------------------------------------------------------------------------
describe("#1081 H2 — binaryChanged forwarding + session-drop trigger (REAL wiring)", () => {
  let bootstrapServer: ReturnType<typeof createApiServer>;
  let appDb: Kysely<JarvisDatabase>;
  let boss: PgBoss;
  let dataContext: DataContextRunner;
  let repository: SettingsRepository;
  let ownerUserId: string;
  let server: FastifyInstance;
  let dropCalls: string[];
  const fake: FakeRpc = {
    installResult: { state: "installed", version: "2.1.183" },
    probeStatus: "ready",
    installCalls: [],
    probeCalls: []
  };

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new SettingsRepository();

    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    bootstrapServer = createApiServer({ appDb, boss, logger: false });
    await bootstrapServer.ready();
    const signUp = await bootstrapServer.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Owner",
        email: "owner@provider-install-h2.test",
        password: "correct horse battery staple"
      }
    });
    ownerUserId = signUp.json<{ user: { id: string } }>().user.id;

    const resolveAccessContext = async (_request: FastifyRequest): Promise<AccessContext> => ({
      actorUserId: ownerUserId,
      requestId: "req-install-h2-test"
    });

    dropCalls = [];
    const onboardingInstall = buildOnboardingInstall({
      enabled: true,
      getConnection: () => makeFakeConnection(fake),
      repository,
      // #1081 H2 — the seam under test: a real reinstall (`binaryChanged: true`) must
      // drop that provider's live sessions; an idempotent no-op (`false`/absent) must not.
      dropSessionsForProvider: async (provider) => {
        dropCalls.push(provider);
      }
    });
    if (!onboardingInstall) throw new Error("seam must be built when enabled");

    const requireKnownUser = async (scopedDb: DataContextDb, userId: string): Promise<User> => {
      const user = await repository.getUserById(scopedDb, userId);
      if (!user) throw new HttpError(404, "User not found");
      return user;
    };
    const assertBootstrapOwnerAdminUser = async (
      scopedDb: DataContextDb,
      userId: string
    ): Promise<User> => {
      const user = await requireKnownUser(scopedDb, userId);
      if (!user.is_bootstrap_owner || !user.is_instance_admin) {
        throw new HttpError(403, "Bootstrap owner permission is required");
      }
      return user;
    };

    const probes: OnboardingProbes = {
      cliPresent: async () => fake.probeStatus !== "not_installed",
      testProviderConnection: async () => ({ status: fake.probeStatus }),
      connectorAccountExists: async () => false
    };

    const dependencies: OnboardingRoutesDependencies = {
      dataContext,
      resolveAccessContext,
      onboardingProbes: probes,
      repository,
      requireKnownUser,
      assertBootstrapOwnerAdminUser,
      requireRequestId: (ctx) => {
        if (!ctx.requestId) throw new HttpError(500, "Request id is missing");
        return ctx.requestId;
      },
      handleRouteError: (error, reply) => handleRouteError(error, reply),
      onboardingInstall
    };

    server = Fastify({ logger: false });
    registerOnboardingRoutes(server, dependencies);
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([
      server?.close(),
      bootstrapServer?.close(),
      appDb?.destroy(),
      boss?.stop({ graceful: false })
    ]);
  });

  it("forwards binaryChanged:true through the response AND drops that provider's sessions", async () => {
    fake.installResult = { state: "installed", version: "2.1.184", binaryChanged: true };
    dropCalls = [];
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/provider-install",
      headers: { "content-type": "application/json" },
      payload: { providerKind: "anthropic" }
    });
    expect(res.statusCode).toBe(200);
    // Fast-json-stringify guard: binaryChanged must survive the response schema, not be
    // silently stripped by additionalProperties:false.
    expect(res.json()).toMatchObject({ installState: "installed", binaryChanged: true });
    expect(dropCalls).toEqual(["anthropic"]);
  });

  it("does NOT drop sessions on an idempotent no-op (binaryChanged:false)", async () => {
    fake.installResult = { state: "installed", version: "2.1.184", binaryChanged: false };
    dropCalls = [];
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/provider-install",
      headers: { "content-type": "application/json" },
      payload: { providerKind: "anthropic" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ installState: "installed", binaryChanged: false });
    expect(dropCalls).toEqual([]);
  });

  it("does NOT drop sessions when binaryChanged is absent", async () => {
    fake.installResult = { state: "installed", version: "2.1.184" };
    dropCalls = [];
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/provider-install",
      headers: { "content-type": "application/json" },
      payload: { providerKind: "anthropic" }
    });
    expect(res.statusCode).toBe(200);
    expect(dropCalls).toEqual([]);
  });
});
