import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { type Kysely } from "kysely";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  ChatMemoryFactsRepository,
  ChatMemorySuppressionsRepository,
  createMemoryFactSignature
} from "@jarv1s/memory";
import { ChatRepository, ChatUserMemorySettingsRepository } from "@jarv1s/chat";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
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
      expect(cols).toContain("provenance");
    } finally {
      await client.end();
    }
  });

  it("0090: chat_memory_facts provenance defaults to inferred", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT column_default, is_nullable, data_type, udt_schema, udt_name
         FROM information_schema.columns
         WHERE table_schema = 'app'
           AND table_name = 'chat_memory_facts'
           AND column_name = 'provenance'`
      );
      expect(res.rowCount).toBe(1);
      expect(res.rows[0].column_default).toContain("'inferred'");
      expect(res.rows[0].is_nullable).toBe("NO");
      expect([
        res.rows[0].data_type,
        `${res.rows[0].udt_schema}.${res.rows[0].udt_name}`
      ]).toContain("app.provenance_kind");
    } finally {
      await client.end();
    }
  });

  it("0092: chat_memory_suppressions table exists with owner-scoped signature columns", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'chat_memory_suppressions'
         ORDER BY column_name`
      );
      const cols = res.rows.map((r: { column_name: string }) => r.column_name);
      expect(cols).toEqual(
        expect.arrayContaining([
          "id",
          "owner_user_id",
          "signature",
          "category",
          "content",
          "reason",
          "created_at"
        ])
      );
    } finally {
      await client.end();
    }
  });

  it("0092: chat_memory_suppressions grants app and worker runtime access", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT grantee, privilege_type
         FROM information_schema.role_table_grants
         WHERE table_schema = 'app'
           AND table_name = 'chat_memory_suppressions'
           AND grantee IN ('jarvis_app_runtime', 'jarvis_worker_runtime')`
      );
      expect(res.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ grantee: "jarvis_app_runtime", privilege_type: "SELECT" }),
          expect.objectContaining({ grantee: "jarvis_app_runtime", privilege_type: "INSERT" }),
          expect.objectContaining({ grantee: "jarvis_worker_runtime", privilege_type: "SELECT" }),
          expect.objectContaining({ grantee: "jarvis_worker_runtime", privilege_type: "INSERT" })
        ])
      );
    } finally {
      await client.end();
    }
  });

  it("0096: chat_memory_suppressions supports corrections log metadata", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const cols = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'chat_memory_suppressions'
         ORDER BY column_name`
      );
      expect(cols.rows.map((r: { column_name: string }) => r.column_name)).toEqual(
        expect.arrayContaining(["source", "fact_id", "before_content", "after_content"])
      );

      const checks = await client.query(
        `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'app'
           AND t.relname = 'chat_memory_suppressions'
           AND c.contype = 'c'`
      );
      const defs = checks.rows.map((r: { def: string }) => r.def).join("\n");
      expect(defs).toContain("corrected");
      expect(defs).toContain("pattern-reject");
      expect(defs).toContain("chat");
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
      expect(fact.provenance).toBe("inferred");

      const facts = await repo.listActiveFacts(scopedDb, userId);
      expect(facts.some((f) => f.id === fact.id)).toBe(true);
    });
  });

  it("preserves explicitly volunteered provenance", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const fact = await repo.insertFact(scopedDb, userId, {
        category: "preference",
        content: "Prefers direct answers",
        provenance: "volunteered"
      });

      expect(fact.provenance).toBe("volunteered");

      const facts = await repo.listActiveFacts(scopedDb, userId);
      expect(facts.find((f) => f.id === fact.id)?.provenance).toBe("volunteered");
    });
  });

  it("creates stable signatures from normalized category and content", () => {
    expect(createMemoryFactSignature("preference", "  Prefers   direct Answers ")).toBe(
      createMemoryFactSignature("preference", "prefers direct answers")
    );
    expect(createMemoryFactSignature("goal", "prefers direct answers")).not.toBe(
      createMemoryFactSignature("preference", "prefers direct answers")
    );
  });

  it("records rejected signatures and checks them owner-locally", async () => {
    const suppressions = new ChatMemorySuppressionsRepository();
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const signature = createMemoryFactSignature("preference", "Prefers direct answers");
      await suppressions.insertSuppression(scopedDb, userId, {
        signature,
        category: "preference",
        content: "Prefers direct answers",
        reason: "rejected"
      });
      await expect(suppressions.isSuppressed(scopedDb, userId, signature)).resolves.toBe(true);
    });
    await dataContext.withDataContext(ctx(ids.userB), async (scopedDb) => {
      const signature = createMemoryFactSignature("preference", "Prefers direct answers");
      await expect(suppressions.isSuppressed(scopedDb, ids.userB, signature)).resolves.toBe(false);
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

// ── worker_runtime RLS policies on memory tables (#98) ───────────────────────

describe("worker_runtime RLS policies on memory tables (#98)", () => {
  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    const seed = new Client({ connectionString: connectionStrings.bootstrap });
    await seed.connect();
    try {
      await seed.query(
        `INSERT INTO app.users (id, email, name) VALUES
           ($1, 'worker-a@test.test', 'Worker A'),
           ($2, 'worker-b@test.test', 'Worker B')`,
        [ids.userA, ids.userB]
      );
      // Pre-seed one chunk per user so SELECT/UPDATE/DELETE isolation is testable
      await seed.query(
        `INSERT INTO app.memory_chunks
           (owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text)
         VALUES
           ($1, 'chat', '/worker-a/path', 0, 1, 'hash-seed-a', 'chunk a'),
           ($2, 'chat', '/worker-b/path', 0, 1, 'hash-seed-b', 'chunk b')`,
        [ids.userA, ids.userB]
      );
      // Pre-seed one file_index entry per user for SELECT/UPDATE/DELETE isolation
      await seed.query(
        `INSERT INTO app.memory_file_index
           (owner_user_id, source_kind, source_path, file_hash, embed_model_name, embed_model_version)
         VALUES
           ($1, 'vault', '/worker-a/file.md', 'hash-fi-a', 'nomic-embed', '1.5'),
           ($2, 'vault', '/worker-b/file.md', 'hash-fi-b', 'nomic-embed', '1.5')`,
        [ids.userA, ids.userB]
      );
      // Pre-seed one link per user for SELECT isolation
      await seed.query(
        `INSERT INTO app.memory_links
           (owner_user_id, from_path, to_path)
         VALUES
           ($1, '/worker-a/from.md', '/worker-a/to.md'),
           ($2, '/worker-b/from.md', '/worker-b/to.md')`,
        [ids.userA, ids.userB]
      );
    } finally {
      await seed.end();
    }
  });

  it("worker can INSERT into memory_chunks for its own actor", async () => {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const result = await client.query(
        `INSERT INTO app.memory_chunks
           (owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text)
         VALUES ($1, 'chat', '/worker-a/new', 0, 1, 'hash-new', 'new chunk')
         RETURNING id`,
        [ids.userA]
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("worker INSERT on memory_chunks is rejected when owner_user_id does not match actor", async () => {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      await expect(
        client.query(
          `INSERT INTO app.memory_chunks
             (owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text)
           VALUES ($1, 'chat', '/forged/path', 0, 1, 'hash-forged', 'forged chunk')`,
          [ids.userB]
        )
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("worker SELECT on memory_chunks returns only the actor's rows", async () => {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const result = await client.query<{ source_path: string }>(
        `SELECT source_path FROM app.memory_chunks`
      );
      const paths = result.rows.map((r) => r.source_path);
      expect(paths).toContain("/worker-a/path");
      expect(paths).not.toContain("/worker-b/path");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("worker UPDATE on memory_chunks is isolated to actor's rows", async () => {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      // Own row update succeeds
      const own = await client.query(
        `UPDATE app.memory_chunks SET text = 'updated' WHERE source_path = '/worker-a/path'`
      );
      expect(own.rowCount).toBe(1);
      // Cross-user row update silently matches nothing (RLS filters it out)
      const cross = await client.query(
        `UPDATE app.memory_chunks SET text = 'hacked' WHERE source_path = '/worker-b/path'`
      );
      expect(cross.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("worker DELETE on memory_chunks is isolated to actor's rows", async () => {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      // Cross-user row delete silently matches nothing
      const cross = await client.query(
        `DELETE FROM app.memory_chunks WHERE source_path = '/worker-b/path'`
      );
      expect(cross.rowCount).toBe(0);
      // Own row delete works
      const own = await client.query(
        `DELETE FROM app.memory_chunks WHERE source_path = '/worker-a/path'`
      );
      expect(own.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("worker SELECT on memory_file_index returns only the actor's rows", async () => {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const result = await client.query<{ source_path: string }>(
        `SELECT source_path FROM app.memory_file_index`
      );
      const paths = result.rows.map((r) => r.source_path);
      expect(paths).toContain("/worker-a/file.md");
      expect(paths).not.toContain("/worker-b/file.md");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("worker can INSERT into memory_file_index for its own actor", async () => {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const result = await client.query(
        `INSERT INTO app.memory_file_index
           (owner_user_id, source_kind, source_path, file_hash, embed_model_name, embed_model_version)
         VALUES ($1, 'vault', '/worker-a/new-file.md', 'hash-new-fi', 'nomic-embed', '1.5')
         RETURNING id`,
        [ids.userA]
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("worker INSERT on memory_file_index is rejected when owner_user_id does not match actor", async () => {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      await expect(
        client.query(
          `INSERT INTO app.memory_file_index
             (owner_user_id, source_kind, source_path, file_hash, embed_model_name, embed_model_version)
           VALUES ($1, 'vault', '/forged/file.md', 'hash-forged-fi', 'nomic-embed', '1.5')`,
          [ids.userB]
        )
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("worker UPDATE on memory_file_index is isolated to actor's rows", async () => {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const own = await client.query(
        `UPDATE app.memory_file_index SET chunk_count = 5 WHERE source_path = '/worker-a/file.md'`
      );
      expect(own.rowCount).toBe(1);
      const cross = await client.query(
        `UPDATE app.memory_file_index SET chunk_count = 999 WHERE source_path = '/worker-b/file.md'`
      );
      expect(cross.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("worker DELETE on memory_file_index is isolated to actor's rows", async () => {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const cross = await client.query(
        `DELETE FROM app.memory_file_index WHERE source_path = '/worker-b/file.md'`
      );
      expect(cross.rowCount).toBe(0);
      const own = await client.query(
        `DELETE FROM app.memory_file_index WHERE source_path = '/worker-a/file.md'`
      );
      expect(own.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("worker SELECT on memory_links returns only the actor's rows", async () => {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const result = await client.query<{ from_path: string }>(
        `SELECT from_path FROM app.memory_links`
      );
      const paths = result.rows.map((r) => r.from_path);
      expect(paths).toContain("/worker-a/from.md");
      expect(paths).not.toContain("/worker-b/from.md");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });
});

// ── Task 9: Memory controls REST API ─────────────────────────────────────────

describe("Memory controls REST API", () => {
  let appDb: Kysely<JarvisDatabase>;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;
  const factsRepo = new ChatMemoryFactsRepository();
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, boss, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
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

  it("GET /api/chat/memory/facts includes provenance and remains owner-scoped", async () => {
    await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.insertFact(scopedDb, ids.userA, {
        category: "preference",
        content: "REST provenance test",
        provenance: "volunteered"
      })
    );

    const userARes = await server.inject({
      method: "GET",
      url: "/api/chat/memory/facts",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(userARes.statusCode).toBe(200);
    const userAFacts = userARes.json<{ facts: { content: string; provenance: string }[] }>().facts;
    expect(userAFacts).toContainEqual(
      expect.objectContaining({ content: "REST provenance test", provenance: "volunteered" })
    );

    const userBRes = await server.inject({
      method: "GET",
      url: "/api/chat/memory/facts",
      headers: { authorization: `Bearer ${ids.sessionB}` }
    });
    expect(userBRes.statusCode).toBe(200);
    const userBFacts = userBRes.json<{ facts: { content: string; provenance?: string }[] }>().facts;
    expect(userBFacts.some((fact) => fact.content === "REST provenance test")).toBe(false);
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

  it("POST /api/chat/memory/facts/:id/confirm promotes an inferred fact", async () => {
    const fact = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.insertFact(scopedDb, ids.userA, {
        category: "preference",
        content: "Confirm route test",
        provenance: "inferred"
      })
    );

    const res = await server.inject({
      method: "POST",
      url: `/api/chat/memory/facts/${fact.id}/confirm`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(204);

    const facts = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.listActiveFacts(scopedDb, ids.userA)
    );
    expect(facts.find((f) => f.id === fact.id)?.provenance).toBe("confirmed");
  });

  it("POST /api/chat/memory/facts/:id/reject deletes inferred fact and writes suppression", async () => {
    const fact = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.insertFact(scopedDb, ids.userA, {
        category: "goal",
        content: "Reject route test",
        provenance: "inferred"
      })
    );

    const res = await server.inject({
      method: "POST",
      url: `/api/chat/memory/facts/${fact.id}/reject`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(204);

    await dataContext.withDataContext(ctx(ids.userA), async (scopedDb) => {
      const facts = await factsRepo.listActiveFacts(scopedDb, ids.userA);
      expect(facts.find((f) => f.id === fact.id)).toBeUndefined();
      const suppressions = new ChatMemorySuppressionsRepository();
      await expect(
        suppressions.isSuppressed(
          scopedDb,
          ids.userA,
          createMemoryFactSignature("goal", "Reject route test")
        )
      ).resolves.toBe(true);
    });
  });

  it("GET /api/chat/memory/corrections returns only the actor's chronological corrections", async () => {
    const suppressions = new ChatMemorySuppressionsRepository();
    await dataContext.withDataContext(ctx(ids.userA), async (scopedDb) => {
      await suppressions.insertSuppression(scopedDb, ids.userA, {
        signature: createMemoryFactSignature("goal", "Owner correction route A"),
        category: "goal",
        content: "Owner correction route A",
        reason: "rejected"
      });
    });
    await dataContext.withDataContext(ctx(ids.userB), async (scopedDb) => {
      await suppressions.insertSuppression(scopedDb, ids.userB, {
        signature: createMemoryFactSignature("goal", "Foreign correction route B"),
        category: "goal",
        content: "Foreign correction route B",
        reason: "rejected"
      });
    });

    const res = await server.inject({
      method: "GET",
      url: "/api/chat/memory/corrections?limit=10",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ corrections: { content: string; reason: string; source: string }[] }>();
    expect(body.corrections).toContainEqual(
      expect.objectContaining({
        content: "Owner correction route A",
        reason: "rejected",
        source: "pattern-reject"
      })
    );
    expect(body.corrections.some((row) => row.content === "Foreign correction route B")).toBe(
      false
    );
  });

  it("non-owner cannot confirm or reject another user's fact", async () => {
    const fact = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.insertFact(scopedDb, ids.userA, {
        category: "preference",
        content: "Non-owner route test",
        provenance: "inferred"
      })
    );

    for (const action of ["confirm", "reject"] as const) {
      const res = await server.inject({
        method: "POST",
        url: `/api/chat/memory/facts/${fact.id}/${action}`,
        headers: { authorization: `Bearer ${ids.sessionB}` }
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it("non-owner cannot delete or patch another user's fact", async () => {
    const fact = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.insertFact(scopedDb, ids.userA, {
        category: "preference",
        content: "Non-owner mutation route test",
        importance: 0.4
      })
    );

    const delRes = await server.inject({
      method: "DELETE",
      url: `/api/chat/memory/facts/${fact.id}`,
      headers: { authorization: `Bearer ${ids.sessionB}` }
    });
    expect(delRes.statusCode).toBe(404);
    expect(delRes.json<{ error: string }>().error).toBe("Memory fact not found");

    const patchRes = await server.inject({
      method: "PATCH",
      url: `/api/chat/memory/facts/${fact.id}`,
      headers: { authorization: `Bearer ${ids.sessionB}` },
      payload: { importance: 0.9 }
    });
    expect(patchRes.statusCode).toBe(404);
    expect(patchRes.json<{ error: string }>().error).toBe("Memory fact not found");

    const facts = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      factsRepo.listActiveFacts(scopedDb, ids.userA)
    );
    expect(facts.find((f) => f.id === fact.id)?.importance).toBeCloseTo(0.4, 2);
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
