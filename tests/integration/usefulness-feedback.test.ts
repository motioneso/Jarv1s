import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { sql, type Kysely } from "kysely";

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
import { ManualMemoryCandidateService } from "../../packages/memory/src/index.js";
import { ChatRepository, createChatFeedbackTargetVerifier } from "../../packages/chat/src/index.js";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

let appDb: Kysely<JarvisDatabase>;

interface MemoryCandidateTestRow {
  readonly id: string;
  readonly kind: string;
  readonly action: string;
  readonly payload_json: unknown;
  readonly status: string;
  readonly confidence: string | number;
  readonly importance: string | number;
  readonly provenance: string;
}

function userAHeaders(): Record<string, string> {
  return { authorization: "Bearer user-a" };
}

function userAContext(): AccessContext {
  return { actorUserId: ids.userA, requestId: "req:feedback-a" };
}

beforeAll(async () => {
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
});

afterAll(async () => {
  await appDb?.destroy();
});

describe("usefulness feedback foundation", () => {
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

  it("remember_this creates one pending memory candidate without storing excerpt on feedback", async () => {
    const { server, dataContext } = await buildFeedbackTestServer(
      appDb,
      rememberableVerifier("remember me safely")
    );
    try {
      const payload = {
        targetKind: "chat_message",
        targetRef: "msg-memory",
        surface: "chat",
        kind: "remember_this"
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
      expect(first.json().feedback.effectKind).toBe("memory_candidate");
      expect(JSON.stringify(first.json().feedback)).not.toContain("remember me safely");

      const candidates = await dataContext.withDataContext(
        userAContext(),
        async (scopedDb) =>
          (
            await sql<MemoryCandidateTestRow>`
            SELECT id, kind, action, payload_json, status, confidence, importance, provenance
            FROM app.memory_candidates
            WHERE owner_user_id = ${ids.userA}::uuid
          `.execute(scopedDb.db)
          ).rows
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        status: "pending",
        kind: "fact",
        action: "create",
        confidence: "0.500",
        importance: "0.500",
        provenance: "volunteered"
      });
      expect(candidates[0]?.payload_json).toMatchObject({
        manualRequest: true,
        excerpt: "remember me safely",
        targetKind: "chat_message",
        targetRef: "msg-memory"
      });
    } finally {
      await server.close();
    }
  });

  it("undo of pending remember_this suppresses the linked memory candidate", async () => {
    const { server, dataContext } = await buildFeedbackTestServer(
      appDb,
      rememberableVerifier("cancel me")
    );
    try {
      const created = await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload: {
          targetKind: "chat_message",
          targetRef: "msg-cancel",
          surface: "chat",
          kind: "remember_this"
        }
      });
      expect(created.statusCode).toBe(201);

      const undone = await server.inject({
        method: "POST",
        url: `/api/me/usefulness-feedback/${created.json().feedback.id}/undo`,
        headers: userAHeaders()
      });
      expect(undone.statusCode).toBe(200);

      const candidate = await dataContext.withDataContext(
        userAContext(),
        async (scopedDb) =>
          (
            await sql<MemoryCandidateTestRow>`
            SELECT id, kind, action, payload_json, status, confidence, importance, provenance
            FROM app.memory_candidates
            WHERE id = ${created.json().feedback.effectRef}::uuid
          `.execute(scopedDb.db)
          ).rows[0]
      );
      expect(candidate?.status).toBe("suppressed");
    } finally {
      await server.close();
    }
  });

  it("verifies chat messages through the chat-owned verifier and rejects other owners/incognito remember", async () => {
    const chatRepository = new ChatRepository();
    const userAMessages = await createStoredChatTurn(chatRepository, false, userAContext());
    const userBMessages = await createStoredChatTurn(chatRepository, false, {
      actorUserId: ids.userB,
      requestId: "req:feedback-b"
    });
    const incognitoMessages = await createStoredChatTurn(chatRepository, true, userAContext());
    const { server } = await buildFeedbackTestServer(
      appDb,
      createChatFeedbackTargetVerifier(chatRepository)
    );
    try {
      const own = await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload: {
          targetKind: "chat_message",
          targetRef: userAMessages.assistantMessage.id,
          surface: "chat",
          kind: "not_useful"
        }
      });
      expect(own.statusCode).toBe(201);

      const otherOwner = await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload: {
          targetKind: "chat_message",
          targetRef: userBMessages.assistantMessage.id,
          surface: "chat",
          kind: "not_useful"
        }
      });
      expect(otherOwner.statusCode).toBe(404);

      const incognitoRemember = await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload: {
          targetKind: "chat_message",
          targetRef: incognitoMessages.userMessage.id,
          surface: "chat",
          kind: "remember_this"
        }
      });
      expect(incognitoRemember.statusCode).toBe(400);
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
    manualMemoryCandidates: new ManualMemoryCandidateService(),
    resolveAccessContext: async () => userAContext()
  });
  await server.ready();
  return { server, dataContext };
}

function rememberableVerifier(excerpt: string): FeedbackTargetVerifier {
  return async (_scopedDb, input) => ({
    ownerUserId: input.actorUserId,
    targetKind: input.targetKind,
    targetRef: input.targetRef,
    surface: input.surface,
    sourceKind: "chat",
    sourceLabel: "Chat",
    metadata: { role: "user" },
    canRemember: true,
    rememberExcerpt: excerpt
  });
}

async function createStoredChatTurn(
  repository: ChatRepository,
  incognito: boolean,
  access: AccessContext
) {
  const dataContext = new DataContextRunner(appDb);
  return dataContext.withDataContext(access, async (scopedDb) => {
    const thread = await repository.openNewThread(scopedDb, { title: "Feedback chat", incognito });
    const messages = await repository.recordCompletedTurn(
      scopedDb,
      thread.id,
      "remember this user-authored line",
      "assistant reply",
      { provider: "anthropic", model: "claude-test" }
    );
    if (!messages) throw new Error("chat test turn was not stored");
    return messages;
  });
}
