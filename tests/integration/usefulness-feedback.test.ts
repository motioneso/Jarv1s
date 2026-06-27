import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import type { Kysely } from "kysely";

import {
  createDatabase,
  DataContextRunner,
  type AccessContext,
  type DataContextDb,
  type JarvisDatabase
} from "@jarv1s/db";
import { getBuiltInModuleManifests, getBuiltInModuleRegistrations } from "@jarv1s/module-registry";
import {
  FeedbackTargetVerifierRegistry,
  registerUsefulnessFeedbackRoutes,
  type FeedbackTargetVerifier,
  type FeedbackTargetVerification
} from "../../packages/usefulness-feedback/src/index.js";

import { connectionStrings, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

function userAHeaders(): Record<string, string> {
  return { authorization: "Bearer user-a" };
}

function userAContext(): AccessContext {
  return { actorUserId: "00000000-0000-4000-8000-000000000001", requestId: "req:feedback-a" };
}

describe("usefulness feedback foundation", () => {
  beforeAll(async () => {
    await resetFoundationDatabase();
  });

  it("registers the required module and applies owner-only RLS without runtime delete", async () => {
    expect(getBuiltInModuleManifests().map((manifest) => manifest.id)).toContain(
      "usefulness-feedback"
    );
    const registration = getBuiltInModuleRegistrations().find(
      (item) => item.manifest.id === "usefulness-feedback"
    );

    expect(registration?.manifest.database?.ownedTables).toEqual([
      "app.usefulness_feedback_signals",
      "app.usefulness_feedback_targets"
    ]);
    expect(registration?.manifest.routes?.map((route) => `${route.method} ${route.path}`)).toEqual([
      "POST /api/me/usefulness-feedback",
      "GET /api/me/usefulness-feedback",
      "POST /api/me/usefulness-feedback/:id/undo"
    ]);

    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const result = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        app_can_delete: boolean;
        worker_can_delete: boolean;
      }>(`
        SELECT
          c.relname,
          c.relrowsecurity,
          c.relforcerowsecurity,
          has_table_privilege('jarvis_app_runtime', c.oid, 'DELETE') AS app_can_delete,
          has_table_privilege('jarvis_worker_runtime', c.oid, 'DELETE') AS worker_can_delete
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app'
          AND c.relname IN ('usefulness_feedback_signals', 'usefulness_feedback_targets')
        ORDER BY c.relname
      `);

      expect(result.rows).toEqual([
        {
          relname: "usefulness_feedback_signals",
          relrowsecurity: true,
          relforcerowsecurity: true,
          app_can_delete: false,
          worker_can_delete: false
        },
        {
          relname: "usefulness_feedback_targets",
          relrowsecurity: true,
          relforcerowsecurity: true,
          app_can_delete: false,
          worker_can_delete: false
        }
      ]);
    } finally {
      await client.end();
    }
  });
});

describe("usefulness feedback routes", () => {
  let appDb: Kysely<JarvisDatabase>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("rejects invalid target/action pairs, target/surface pairs, and unknown top-level keys", async () => {
    const { server } = await buildFeedbackTestServer(appDb);
    try {
      const invalidAction = await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload: {
          targetKind: "chat_message",
          targetRef: "msg-a",
          surface: "chat",
          kind: "dismiss"
        }
      });
      expect(invalidAction.statusCode).toBe(400);

      const invalidSurface = await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload: {
          targetKind: "chat_message",
          targetRef: "msg-a",
          surface: "today",
          kind: "not_useful"
        }
      });
      expect(invalidSurface.statusCode).toBe(400);

      const extraKey = await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload: {
          targetKind: "chat_message",
          targetRef: "msg-a",
          surface: "chat",
          kind: "not_useful",
          extra: true
        }
      });
      expect(extraKey.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("creates idempotent active feedback before repeating verifier side effects and undoes it", async () => {
    let calls = 0;
    const { server } = await buildFeedbackTestServer(appDb, async () => {
      calls += 1;
      return {
        ownerUserId: userAContext().actorUserId,
        targetKind: "chat_message",
        targetRef: "msg-a",
        surface: "chat",
        sourceKind: "chat",
        sourceLabel: "Chat",
        priorityBand: "normal",
        metadata: { role: "assistant" },
        canRemember: false
      };
    });
    try {
      const payload = {
        targetKind: "chat_message",
        targetRef: "msg-a",
        surface: "chat",
        kind: "not_useful"
      };
      const first = await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload
      });
      const second = await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().feedback.id).toBe(first.json().feedback.id);
      expect(calls).toBe(1);

      const undo = await server.inject({
        method: "POST",
        url: `/api/me/usefulness-feedback/${first.json().feedback.id}/undo`,
        headers: userAHeaders()
      });
      expect(undo.statusCode).toBe(200);
      expect(undo.json().feedback.status).toBe("undone");
      expect(undo.json().feedback.resolvedAt).toEqual(expect.any(String));
    } finally {
      await server.close();
    }
  });
});

async function buildFeedbackTestServer(
  appDb: Kysely<JarvisDatabase>,
  verifier?: FeedbackTargetVerifier
): Promise<{ server: FastifyInstance; dataContext: DataContextRunner }> {
  const dataContext = new DataContextRunner(appDb);
  const registry = new FeedbackTargetVerifierRegistry();
  registry.register(
    "chat_message",
    verifier ??
      (async (_scopedDb: DataContextDb, input): Promise<FeedbackTargetVerification | null> => ({
        ownerUserId: input.actorUserId,
        targetKind: input.targetKind,
        targetRef: input.targetRef,
        surface: input.surface,
        canRemember: false
      }))
  );

  const server = Fastify({ logger: false });
  registerUsefulnessFeedbackRoutes(server, {
    dataContext,
    registry,
    resolveAccessContext: async () => userAContext()
  });
  await server.ready();
  return { server, dataContext };
}
