import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerHostDiagnosticsRoutes } from "../../packages/settings/src/host-diagnostics-routes.js";

function registerTestRoutes(actions: {
  readonly requestRestart?: () => void | Promise<void>;
  readonly installHerdr?: () => void | Promise<void>;
}) {
  const server = Fastify();
  registerHostDiagnosticsRoutes(server, {
    dataContext: {
      withDataContext: async (_accessContext: unknown, fn: (scopedDb: never) => unknown) =>
        fn({} as never)
    } as never,
    resolveAccessContext: async () => ({ actorUserId: "admin-1" }) as never,
    repository: {} as never,
    assertAdminUser: async () => ({ id: "admin-1" }) as never,
    handleRouteError: (error, reply) => {
      const status =
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      return reply.status(status).send({ error: (error as Error).message });
    },
    requestRestart: actions.requestRestart,
    installHerdr: actions.installHerdr
  });
  return server;
}

describe("host admin action routes", () => {
  it("POST /api/admin/host/restart accepts and invokes the restart hook", async () => {
    let calls = 0;
    const server = registerTestRoutes({
      requestRestart: () => {
        calls += 1;
      }
    });

    const res = await server.inject({ method: "POST", url: "/api/admin/host/restart" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: true });
    expect(calls).toBe(1);
  });

  it("POST /api/admin/host/herdr/install accepts and invokes the install hook", async () => {
    let calls = 0;
    const server = registerTestRoutes({
      installHerdr: () => {
        calls += 1;
      }
    });

    const res = await server.inject({ method: "POST", url: "/api/admin/host/herdr/install" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ installed: true });
    expect(calls).toBe(1);
  });
});
