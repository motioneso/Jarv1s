import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { type Kysely } from "kysely";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { ChatMemoryFactsRepository } from "@jarv1s/memory";
import { ChatRepository, ChatUserMemorySettingsRepository } from "@jarv1s/chat";
import { createApiServer } from "../../apps/api/src/server.js";
import {
  connectionStrings,
  ids,
  resetEmptyFoundationDatabase,
  resetFoundationDatabase
} from "./test-database.js";

const { Client } = pg;

function ctx(actorUserId: string): AccessContext {
  return { actorUserId, requestId: "req:recall-test" };
}

// ── Task 1: Schema assertions ─────────────────────────────────────────────────

describe("Phase 3 Recall migrations", () => {
  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
  });

  it("0040: memory_chunks allows source_kind='chat'", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const check = await client.query(
        `SELECT check_clause FROM information_schema.check_constraints
         WHERE constraint_name = 'memory_chunks_source_kind_check'`
      );
      const clause = check.rows[0]?.check_clause ?? "";
      expect(clause).toContain("chat");
    } finally {
      await client.end();
    }
  });

  it("0040: jarvis_worker_runtime has INSERT on memory_chunks", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT 1 FROM information_schema.role_table_grants
         WHERE grantee = 'jarvis_worker_runtime'
           AND table_schema = 'app'
           AND table_name = 'memory_chunks'
           AND privilege_type = 'INSERT'`
      );
      expect(res.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("0041: chat_memory_facts table exists with expected columns", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'chat_memory_facts'
         ORDER BY column_name`
      );
      const cols = res.rows.map((r: { column_name: string }) => r.column_name);
      expect(cols).toContain("id");
      expect(cols).toContain("owner_user_id");
      expect(cols).toContain("category");
      expect(cols).toContain("content");
      expect(cols).toContain("status");
      expect(cols).toContain("importance");
    } finally {
      await client.end();
    }
  });

  it("0042: chat_user_memory_settings table exists", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'app' AND table_name = 'chat_user_memory_settings'`
      );
      expect(res.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("0042: chat_threads has incognito column", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'chat_threads'
           AND column_name = 'incognito'`
      );
      expect(res.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });
});

// ── Task 3: ChatMemoryFactsRepository ─────────────────────────────────────────

describe("ChatMemoryFactsRepository", () => {
  const repo = new ChatMemoryFactsRepository();
  const userId = ids.userA;
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  it("inserts an active fact and lists it back", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const fact = await repo.insertFact(scopedDb, userId, {
        category: "preference",
        content: "Prefers dark mode",
        importance: 0.8
      });
      expect(fact.id).toBeTruthy();
      expect(fact.category).toBe("preference");
      expect(fact.content).toBe("Prefers dark mode");
      expect(fact.status).toBe("active");
      expect(fact.importance).toBeCloseTo(0.8, 2);

      const facts = await repo.listActiveFacts(scopedDb, userId);
      expect(facts.some((f) => f.id === fact.id)).toBe(true);
    });
  });

  it("supersedes a fact", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const fact = await repo.insertFact(scopedDb, userId, {
        category: "fact",
        content: "Lives in NYC"
      });
      await repo.supersedeFact(scopedDb, fact.id);
      const facts = await repo.listActiveFacts(scopedDb, userId);
      expect(facts.find((f) => f.id === fact.id)).toBeUndefined();
    });
  });

  it("deletes a fact", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const fact = await repo.insertFact(scopedDb, userId, {
        category: "goal",
        content: "Learn piano"
      });
      await repo.deleteFact(scopedDb, fact.id);
      const facts = await repo.listActiveFacts(scopedDb, userId);
      expect(facts.find((f) => f.id === fact.id)).toBeUndefined();
    });
  });

  it("respects RLS — userB cannot see userA facts", async () => {
    const userBId = ids.userB;
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.insertFact(scopedDb, userId, {
        category: "profile",
        content: "RLS isolation test"
      });
    });
    await dataContext.withDataContext(ctx(userBId), async (scopedDb) => {
      const facts = await repo.listActiveFacts(scopedDb, userBId);
      expect(facts.every((f) => f.ownerUserId === userBId)).toBe(true);
    });
  });
});

// ── Task 4: ChatUserMemorySettingsRepository ──────────────────────────────────

describe("ChatUserMemorySettingsRepository", () => {
  const repo = new ChatUserMemorySettingsRepository();
  const userId = ids.userA;
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  it("getOrCreate returns defaults for a new user", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const settings = await repo.getOrCreate(scopedDb, userId);
      expect(settings.userId).toBe(userId);
      expect(settings.recallEnabled).toBe(true);
      expect(settings.factsEnabled).toBe(true);
    });
  });

  it("getOrCreate is idempotent", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const first = await repo.getOrCreate(scopedDb, userId);
      const second = await repo.getOrCreate(scopedDb, userId);
      expect(second.userId).toBe(first.userId);
      expect(second.recallEnabled).toBe(first.recallEnabled);
    });
  });

  it("update patches individual fields", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const updated = await repo.update(scopedDb, userId, { recallEnabled: false });
      expect(updated.recallEnabled).toBe(false);
      expect(updated.factsEnabled).toBe(true);
    });
  });
});

// ── Task 9: Memory controls REST API ─────────────────────────────────────────

describe("Memory controls REST API", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  const factsRepo = new ChatMemoryFactsRepository();
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    server = createApiServer({ appDb, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("GET /api/chat/memory/settings returns defaults for a new user", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/chat/memory/settings",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ recallEnabled: boolean; factsEnabled: boolean }>();
    expect(body.recallEnabled).toBe(true);
    expect(body.factsEnabled).toBe(true);
  });

  it("GET /api/chat/memory/settings returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: "/api/chat/memory/settings" });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /api/chat/memory/settings toggles recall off", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/api/chat/memory/settings",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { recallEnabled: false }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ recallEnabled: boolean; factsEnabled: boolean }>();
    expect(body.recallEnabled).toBe(false);
    expect(body.factsEnabled).toBe(true);
  });

  it("GET /api/chat/memory/facts returns empty list when no facts", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/chat/memory/facts",
      headers: { authorization: `Bearer ${ids.sessionB}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ facts: unknown[] }>().facts).toHaveLength(0);
  });

  it("DELETE /api/chat/memory/facts/:id removes a fact", async () => {
    const fact = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.insertFact(scopedDb, ids.userA, {
        category: "preference",
        content: "REST delete test"
      })
    );

    const delRes = await server.inject({
      method: "DELETE",
      url: `/api/chat/memory/facts/${fact.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(delRes.statusCode).toBe(204);

    const facts = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.listActiveFacts(scopedDb, ids.userA)
    );
    expect(facts.find((f) => f.id === fact.id)).toBeUndefined();
  });

  it("PATCH /api/chat/memory/facts/:id with invalid importance returns 400", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/api/chat/memory/facts/00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { importance: 2.5 }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain("importance");
  });

  it("POST /api/chat/clear?incognito=true opens an incognito thread", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/chat/clear?incognito=true",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(204);

    const thread = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      new ChatRepository().getCurrentThread(scopedDb, ids.userA)
    );
    expect(thread?.incognito).toBe(true);
  });
});
