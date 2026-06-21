import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import type { AccessContext, DataContextDb, User } from "@jarv1s/db";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import type { OnboardingProviderKind } from "@jarv1s/shared";

import {
  registerOnboardingRoutes,
  type OnboardingRoutesDependencies
} from "../../packages/settings/src/onboarding-routes.js";

// ---------------------------------------------------------------------------
// #365 unit: the GET /api/onboarding/status handler must derive a per-provider
// installableByKind map from the install seam's PURE installability port and pass it
// into the assembler. Here the assembler is faked to CAPTURE its input (the real
// assembler's behavior is covered in tests/integration/onboarding.test.ts), so this
// proves only the route wiring. No DB, no cli-runner.
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = "admin-token";
const ADMIN_USER_ID = "user-admin";
const adminUser = () =>
  ({ id: ADMIN_USER_ID, is_bootstrap_owner: true, is_instance_admin: true }) as unknown as User;

interface AssembleInput {
  readonly installableByKind?: Readonly<Partial<Record<OnboardingProviderKind, boolean>>>;
}

function buildServer(captured: { input?: AssembleInput }): FastifyInstance {
  const dependencies: OnboardingRoutesDependencies = {
    dataContext: {
      withDataContext: async (_c: AccessContext, fn: (db: DataContextDb) => Promise<unknown>) =>
        fn({ __scoped: true } as unknown as DataContextDb)
    } as unknown as OnboardingRoutesDependencies["dataContext"],
    resolveAccessContext: async (request: FastifyRequest): Promise<AccessContext> => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (token === ADMIN_TOKEN) return { actorUserId: ADMIN_USER_ID, requestId: "req-1" };
      throw new HttpError(401, "no session");
    },
    // Only the methods the status handler calls. assembleOnboardingStatus captures its input and
    // returns a minimal valid founder status — the REAL assembler is covered in the integration suite.
    repository: {
      getMemberOnboardingState: async () => ({ completedAt: null }),
      readOnboardingState: async () => "pending",
      assembleOnboardingStatus: (input: AssembleInput) => {
        captured.input = input;
        return {
          role: "founder",
          state: "pending",
          steps: {
            cliAuth: { done: false, providers: [] },
            connectors: { done: false }
          }
        };
      }
    } as unknown as OnboardingRoutesDependencies["repository"],
    requireKnownUser: async () => adminUser(),
    assertBootstrapOwnerAdminUser: async () => adminUser(),
    requireRequestId: (ctx) => {
      if (!ctx.requestId) throw new HttpError(500, "Request id is missing");
      return ctx.requestId;
    },
    handleRouteError: (error, reply) => handleRouteError(error, reply),
    onboardingProbes: {
      cliPresent: async () => false,
      testProviderConnection: async () => ({ status: "needs_login" }),
      connectorAccountExists: async () => false
    },
    onboardingInstall: {
      installability: (provider: OnboardingProviderKind) =>
        provider === "google"
          ? { installable: false, blockedReason: "agy spike unresolved" }
          : { installable: true },
      installClient: async () => ({ state: "installed" }),
      stateStore: {
        persistInstalling: async () => undefined,
        persistTerminal: async () => "installed"
      },
      reconcileInstallStates: async () => ({ anthropic: "ready" })
    }
  };
  const server = Fastify({ logger: false });
  registerOnboardingRoutes(server, dependencies);
  return server;
}

describe("GET /api/onboarding/status installable wiring (#365)", () => {
  it("passes a catalog-derived installableByKind into the assembler", async () => {
    const captured: { input?: AssembleInput } = {};
    const server = buildServer(captured);
    await server.ready();
    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    await server.close();
    expect(res.statusCode).toBe(200);
    expect(captured.input?.installableByKind).toEqual({
      anthropic: true,
      "openai-compatible": true,
      google: false
    });
  });
});
