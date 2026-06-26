import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  dataContextBrand,
  type AccessContext,
  type DataContextDb,
  type DataContextRunner
} from "../../packages/db/src/index.js";
import { EMBED_PROVIDER_CONFIG_KEY } from "../../packages/settings/src/runtime-config-keys.js";
import { registerRuntimeConfigRoutes } from "../../packages/settings/src/runtime-config-routes.js";
import type { SettingsRepository } from "../../packages/settings/src/repository.js";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";

function makeScopedDb(settings: Map<string, Record<string, unknown>>): DataContextDb {
  return {
    [dataContextBrand]: true,
    db: {
      selectFrom: () => ({
        select: () => ({
          where: (_column: string, _op: string, key: string) => ({
            executeTakeFirst: async () => {
              const value = settings.get(key);
              return value === undefined ? undefined : { value };
            }
          })
        })
      })
    }
  } as unknown as DataContextDb;
}

function makeServer(options?: {
  readonly initialSettings?: readonly [string, Record<string, unknown>][];
  readonly env?: NodeJS.ProcessEnv;
}): {
  readonly server: FastifyInstance;
  readonly upserts: unknown[];
} {
  const server = Fastify({ logger: false });
  const settings = new Map(options?.initialSettings ?? []);
  const scopedDb = makeScopedDb(settings);
  const upserts: unknown[] = [];

  registerRuntimeConfigRoutes(server, {
    dataContext: {
      withDataContext: async <T>(
        _accessContext: AccessContext,
        work: (db: DataContextDb) => Promise<T>
      ): Promise<T> =>
        work(scopedDb)
    } as unknown as DataContextRunner,
    resolveAccessContext: async () => ({ actorUserId: ACTOR_ID, requestId: "req-runtime-config" }),
    repository: {
      getUserById: async () => ({
        id: ACTOR_ID,
        email: "admin@example.com",
        name: "Admin",
        email_verified: true,
        image: null,
        is_instance_admin: true,
        status: "active",
        is_bootstrap_owner: false,
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        updated_at: new Date("2026-01-01T00:00:00.000Z")
      }),
      upsertInstanceSetting: async (_db: DataContextDb, input) => {
        upserts.push(input);
        settings.set(String(input.key), input.value as Record<string, unknown>);
        return {
          key: input.key,
          value: input.value,
          updated_by_user_id: input.updatedByUserId,
          created_at: new Date("2026-01-01T00:00:00.000Z"),
          updated_at: new Date("2026-01-01T00:00:00.000Z")
        };
      },
      deleteInstanceSetting: async (_db: DataContextDb, input: { key: string }) => {
        return settings.delete(input.key);
      }
    } satisfies Pick<
      SettingsRepository,
      "getUserById" | "upsertInstanceSetting" | "deleteInstanceSetting"
    > as unknown as SettingsRepository,
    env: options?.env ?? {}
  });

  return { server, upserts };
}

describe("runtime config admin routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("returns instance config status without exposing anything extra", async () => {
    ({ server } = makeServer({
      initialSettings: [[EMBED_PROVIDER_CONFIG_KEY, { value: "stub" }]],
      env: { JARVIS_EMBED_PROVIDER: "local" }
    }));

    const res = await server.inject({
      method: "GET",
      url: `/api/admin/runtime-config/${EMBED_PROVIDER_CONFIG_KEY}`
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ config: { value: "stub", source: "instance" } });
  });

  it("validates and upserts runtime config with metadata-only audit data", async () => {
    const made = makeServer();
    server = made.server;

    const res = await server.inject({
      method: "PUT",
      url: `/api/admin/runtime-config/${EMBED_PROVIDER_CONFIG_KEY}`,
      payload: { value: "stub" }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ config: { value: "stub", source: "instance" } });
    expect(made.upserts).toMatchObject([
      {
        key: EMBED_PROVIDER_CONFIG_KEY,
        value: { value: "stub" },
        updatedByUserId: ACTOR_ID,
        requestId: "req-runtime-config",
        action: "runtime_config.ai.embed_provider.set",
        metadata: { key: EMBED_PROVIDER_CONFIG_KEY }
      }
    ]);
    expect(JSON.stringify(made.upserts)).not.toContain('"stub","');
  });

  it("rejects invalid enum values before writing", async () => {
    const made = makeServer();
    server = made.server;

    const res = await server.inject({
      method: "PUT",
      url: `/api/admin/runtime-config/${EMBED_PROVIDER_CONFIG_KEY}`,
      payload: { value: "stb" }
    });

    expect(res.statusCode).toBe(400);
    expect(made.upserts).toEqual([]);
  });
});
