import { describe, it, expect, vi } from "vitest";
import { registerActionPolicyRoutes } from "../../packages/ai/src/action-policy-routes.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AiRoutesDependencies } from "../../packages/ai/src/routes.js";
import type { AiRepository } from "../../packages/ai/src/repository.js";
import type { DataContextRunner, DataContextDb } from "@jarv1s/db";

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type AnyFn = Function;

describe("action policy routes", () => {
  it("rejects PATCH if module is not active", async () => {
    let handler: unknown;
    const mockServer = {
      get: vi.fn(),
      patch: vi.fn((_path, _opts, h) => {
        handler = h;
      })
    };

    const mockDeps = {
      resolveAccessContext: async () => ({ actorUserId: "user1" }),
      resolveActiveModules: async () => [],
      dataContext: {
        withDataContext: async (_ctx: unknown, fn: (db: DataContextDb) => unknown) =>
          fn({} as DataContextDb)
      } as unknown as DataContextRunner
    } as unknown as AiRoutesDependencies;

    registerActionPolicyRoutes(
      mockServer as unknown as FastifyInstance,
      mockDeps,
      {} as AiRepository
    );

    const request = {
      params: { moduleId: "test_module", actionFamilyId: "test_family" },
      body: { tier: "trusted_auto" }
    } as unknown as FastifyRequest;
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn()
    } as unknown as FastifyReply;

    await (handler as AnyFn)(request, reply);
    expect(reply.code).toHaveBeenCalledWith(404);
  });

  it("rejects PATCH if family does not exist in module", async () => {
    let handler: unknown;
    const mockServer = {
      get: vi.fn(),
      patch: vi.fn((_path, _opts, h) => {
        handler = h;
      })
    };

    const mockDeps = {
      resolveAccessContext: async () => ({ actorUserId: "user1" }),
      resolveActiveModules: async () => [
        {
          id: "test_module",
          assistantActionFamilies: []
        }
      ],
      dataContext: {
        withDataContext: async (_ctx: unknown, fn: (db: DataContextDb) => unknown) =>
          fn({} as DataContextDb)
      } as unknown as DataContextRunner
    } as unknown as AiRoutesDependencies;

    registerActionPolicyRoutes(
      mockServer as unknown as FastifyInstance,
      mockDeps,
      {} as AiRepository
    );

    const request = {
      params: { moduleId: "test_module", actionFamilyId: "test_family" },
      body: { tier: "trusted_auto" }
    } as unknown as FastifyRequest;
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn()
    } as unknown as FastifyReply;

    await (handler as AnyFn)(request, reply);
    expect(reply.code).toHaveBeenCalledWith(404);
  });

  it("rejects PATCH if tier is not allowed by family", async () => {
    let handler: unknown;
    const mockServer = {
      get: vi.fn(),
      patch: vi.fn((_path, _opts, h) => {
        handler = h;
      })
    };

    const mockDeps = {
      resolveAccessContext: async () => ({ actorUserId: "user1" }),
      resolveActiveModules: async () => [
        {
          id: "test_module",
          assistantActionFamilies: [
            {
              id: "test_family",
              allowedTiers: ["ask_each_time"]
            }
          ]
        }
      ],
      dataContext: {
        withDataContext: async (_ctx: unknown, fn: (db: DataContextDb) => unknown) =>
          fn({} as DataContextDb)
      } as unknown as DataContextRunner
    } as unknown as AiRoutesDependencies;

    registerActionPolicyRoutes(
      mockServer as unknown as FastifyInstance,
      mockDeps,
      {} as AiRepository
    );

    const request = {
      params: { moduleId: "test_module", actionFamilyId: "test_family" },
      body: { tier: "trusted_auto" }
    } as unknown as FastifyRequest;
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn()
    } as unknown as FastifyReply;

    await (handler as AnyFn)(request, reply);
    expect(reply.code).toHaveBeenCalledWith(400);
  });
});
