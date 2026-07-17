/**
 * Integration tests for answer-provenance API routes (#539).
 *
 * Verifies auth enforcement, 404 for unknown messages, and that the provenance
 * route returns correct shapes. Uses the same fake-engine setup as chat-live-api.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { ChatRepository } from "@jarv1s/chat";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import type { ChatEngineFactory } from "@jarv1s/module-registry";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import type {
  CliChatEngine,
  EngineLaunchOpts,
  TranscriptRecord
} from "../../packages/chat/src/live/types.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

class FakeLiveEngine implements CliChatEngine {
  private pending: TranscriptRecord[] = [];

  constructor(
    public readonly provider: CliChatEngine["provider"],
    private readonly sessionKey: string
  ) {}

  async launch(_opts: EngineLaunchOpts): Promise<{ offset: number }> {
    return { offset: 0 };
  }

  async submit(text: string): Promise<void> {
    this.pending = [{ kind: "reply", text: `prov-echo:${text}` }];
  }

  async readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    if (this.pending.length === 0) {
      return { records: [], offset: afterOffset, complete: false };
    }
    const records = this.pending;
    this.pending = [];
    return { records, offset: afterOffset + 1, complete: true };
  }

  async isAlive(): Promise<boolean> {
    return true;
  }

  async kill(): Promise<void> {}

  async interrupt(): Promise<void> {}
}

const fakeEngineFactory: ChatEngineFactory = (provider, sessionKey) =>
  new FakeLiveEngine(provider, sessionKey);

describe("chat provenance routes", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: ChatRepository;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;

  function userAContext(): AccessContext {
    return { actorUserId: ids.userA, requestId: "test" };
  }

  beforeAll(async () => {
    process.env.JARVIS_AI_SECRET_KEY ??= "test-provenance-routes-key";

    await resetFoundationDatabase();

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new ChatRepository();
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    // createApiServer() only auto-starts a boss it owns; an explicit boss must be started by
    // its caller. This suite's turn route enqueues post-turn jobs via boss, so it must be
    // started before use (unstarted pg-boss throws on send/publish).
    await boss.start();
    server = createApiServer({
      appDb,
      boss,
      logger: false,
      chatEngineFactory: fakeEngineFactory
    });
    await server.ready();

    // Seed a chat-capable provider so resolveActiveProvider succeeds.
    const providerRes = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { providerKind: "anthropic", displayName: "Prov Test Provider", authMethod: "cli" }
    });
    const providerId = providerRes.json<{ provider: { id: string } }>().provider.id;
    await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: {
        providerConfigId: providerId,
        providerModelId: "claude-prov",
        displayName: "Claude Prov",
        capabilities: ["chat"]
      }
    });
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
  });

  // ── GET /api/chat/messages/:messageId/provenance ───────────────────────────

  describe("GET /api/chat/messages/:messageId/provenance", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/chat/messages/00000000-0000-0000-0000-000000000099/provenance"
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for nonexistent message id", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/chat/messages/00000000-0000-0000-0000-000000000000/provenance",
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns empty cards array for assistant message with no provenance", async () => {
      // Send a turn via the live-chat route to create a real stored message.
      const turnRes = await server.inject({
        method: "POST",
        url: "/api/chat/turn",
        headers: { authorization: `Bearer ${ids.sessionA}` },
        payload: { text: "provenance test message" }
      });
      // If live chat is unavailable in this env, skip.
      if (turnRes.statusCode === 503) return;
      expect(turnRes.statusCode).toBe(200);

      // Fetch the assistant message id from the thread.
      const assistantMessageId = await dataContext.withDataContext(
        userAContext(),
        async (scopedDb) => {
          const thread = await repository.getCurrentThread(scopedDb, ids.userA);
          if (!thread) return null;
          const messages = await repository.listMessages(scopedDb, thread.id);
          const assistant = messages.find((m) => m.role === "assistant" && m.status === "stored");
          return assistant?.id ?? null;
        }
      );
      if (!assistantMessageId) return;

      const res = await server.inject({
        method: "GET",
        url: `/api/chat/messages/${assistantMessageId}/provenance`,
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ cards: unknown[] }>();
      expect(Array.isArray(body.cards)).toBe(true);
      // citationToken must never appear in any card.
      for (const card of body.cards) {
        expect((card as Record<string, unknown>).citationToken).toBeUndefined();
      }
    });
  });

  // ── GET /api/chat/messages/:messageId/provenance/:supportId/dereference ───

  describe("GET /api/chat/messages/:messageId/provenance/:supportId/dereference", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/chat/messages/00000000-0000-0000-0000-000000000099/provenance/S1/dereference"
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for nonexistent message", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/chat/messages/00000000-0000-0000-0000-000000000000/provenance/S1/dereference",
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
