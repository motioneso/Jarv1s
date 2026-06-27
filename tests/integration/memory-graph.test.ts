import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { sql, type Kysely } from "kysely";
import pg from "pg";

import {
  createDatabase,
  DataContextRunner,
  type DataContextDb,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  GraphMemoryRecallService,
  MemoryGraphRepository,
  registerMemoryGraphRoutes,
  StubEmbeddingProvider,
  type MemoryFactPredicate
} from "@jarv1s/memory";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const graphTables = [
  "memory_entities",
  "memory_facts",
  "memory_episodes",
  "memory_fact_sources",
  "memory_aliases",
  "memory_search_documents",
  "memory_legacy_fact_migrations"
] as const;

let appDb: Kysely<JarvisDatabase>;
let workerDb: Kysely<JarvisDatabase>;
let migrationDb: Kysely<JarvisDatabase>;
let appDataContext: DataContextRunner;
let workerDataContext: DataContextRunner;
let graphServer: FastifyInstance;
let originalEmbedProvider: string | undefined;

beforeAll(async () => {
  originalEmbedProvider = process.env.JARVIS_EMBED_PROVIDER;
  process.env.JARVIS_EMBED_PROVIDER = "stub";
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });
  migrationDb = createDatabase({
    connectionString: connectionStrings.migration,
    maxConnections: 1
  });
  appDataContext = new DataContextRunner(appDb);
  workerDataContext = new DataContextRunner(workerDb);
  graphServer = Fastify();
  registerMemoryGraphRoutes(graphServer, {
    dataContext: appDataContext,
    resolveAccessContext
  });
  await graphServer.ready();
});

afterAll(async () => {
  await graphServer?.close();
  await appDb?.destroy();
  await workerDb?.destroy();
  await migrationDb?.destroy();
  if (originalEmbedProvider === undefined) {
    delete process.env.JARVIS_EMBED_PROVIDER;
  } else {
    process.env.JARVIS_EMBED_PROVIDER = originalEmbedProvider;
  }
});

describe("memory graph schema and RLS", () => {
  it("creates owner-scoped FORCE RLS tables for app and worker roles", async () => {
    const tables = await sql<{ table_name: string; force_rls: boolean }>`
      SELECT c.relname AS table_name, c.relforcerowsecurity AS force_rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app'
        AND c.relname = ANY(${graphTables}::text[])
      ORDER BY c.relname
    `.execute(migrationDb);

    expect(tables.rows.map((r) => r.table_name)).toEqual([...graphTables].sort());
    expect(tables.rows.every((r) => r.force_rls)).toBe(true);

    const policies = await sql<{ table_name: string; role_name: string }>`
      SELECT c.relname AS table_name, g.rolname AS role_name
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      CROSS JOIN LATERAL unnest(p.polroles) AS role_oid(oid)
      JOIN pg_roles g ON g.oid = role_oid.oid
      WHERE c.relname = ANY(${graphTables}::text[])
      ORDER BY c.relname, g.rolname
    `.execute(migrationDb);

    for (const table of graphTables) {
      const roles = policies.rows.filter((r) => r.table_name === table).map((r) => r.role_name);
      expect(roles).toContain("jarvis_app_runtime");
      expect(roles).toContain("jarvis_worker_runtime");
    }
  });

  it("prevents cross-user reads and writes through app and worker roles", async () => {
    await expectGraphIsolation(appDataContext, "app");
    await expectGraphIsolation(workerDataContext, "worker");
  });
});

describe("MemoryGraphRepository", () => {
  const repo = new MemoryGraphRepository();

  it("creates one self entity per owner and survives repeated calls", async () => {
    const selfA = await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "memory-graph:self-a" },
      (db) => repo.ensureSelfEntity(db, ids.userA)
    );
    const selfB = await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "memory-graph:self-b" },
      (db) => repo.ensureSelfEntity(db, ids.userA)
    );

    expect(selfB.id).toBe(selfA.id);
    expect(selfA.kind).toBe("self");
    expect(selfA.name).toBe("Self");
  });

  it("creates source-backed facts, aliases, and search documents", async () => {
    await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "memory-graph:repo" },
      async (db) => {
        const project = await repo.createEntity(db, ids.userA, {
          kind: "project",
          name: "House project",
          summary: "Kitchen remodel",
          importance: 0.7,
          pinned: false
        });
        const alias = await repo.addAlias(db, ids.userA, project.id, "remodel", false);
        const fact = await repo.createFact(db, ids.userA, {
          subjectEntityId: project.id,
          predicate: "has_constraint" satisfies MemoryFactPredicate,
          objectText: "budget ceiling is 50k",
          confidence: 0.9,
          provenance: "confirmed",
          importance: 0.8,
          pinned: true,
          source: {
            sourceKind: "manual",
            sourceRef: "manual:test",
            sourceLabel: "Manual test",
            excerpt: "Budget ceiling is 50k"
          }
        });

        const docs = await repo.listSearchDocumentsForOwner(db, ids.userA);
        expect(alias.normalizedAlias).toBe("remodel");
        expect(fact.sources).toHaveLength(1);
        expect(docs.map((d) => `${d.targetKind}:${d.targetId}`)).toContain(
          `entity:${project.id}`
        );
        expect(docs.map((d) => `${d.targetKind}:${d.targetId}`)).toContain(`fact:${fact.id}`);
      }
    );
  });
});

describe("GraphMemoryRecallService", () => {
  it("recalls ranked, active, source-backed memory for a query", async () => {
    const service = new GraphMemoryRecallService(new StubEmbeddingProvider());

    const result = await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "memory-graph:recall" },
      async (db) => {
        const written = await service.remember(db, ids.userA, {
          predicate: "prefers",
          objectText: `concise mobile responses ${randomUUID()}`,
          confidence: 0.95,
          provenance: "confirmed",
          importance: 0.9,
          pinned: true,
          source: {
            sourceKind: "manual",
            sourceRef: "manual:recall-test",
            sourceLabel: "Manual memory",
            excerpt: "Ben prefers concise mobile responses."
          }
        });
        await service.remember(db, ids.userA, {
          predicate: "related_to",
          objectText: "low priority unrelated fact",
          confidence: 0.4,
          provenance: "inferred",
          importance: 0.1,
          source: {
            sourceKind: "manual",
            sourceRef: "manual:noise",
            excerpt: "Noise"
          }
        });
        return { written, recalled: await service.recall(db, ids.userA, "mobile responses") };
      }
    );

    expect(result.recalled.items[0]).toMatchObject({
      kind: "fact",
      id: result.written.fact.id,
      provenance: "confirmed",
      confidence: 0.95
    });
    expect(result.recalled.items[0]?.sources.length).toBeGreaterThan(0);
  });

  it("returns capped core memory and excludes superseded facts", async () => {
    const service = new GraphMemoryRecallService(new StubEmbeddingProvider());

    const result = await appDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "memory-graph:core" },
      async (db) => {
        const write = await service.remember(db, ids.userA, {
          predicate: "has_goal",
          objectText: `goal ${randomUUID()}`,
          confidence: 0.9,
          provenance: "confirmed",
          importance: 0.9,
          pinned: true,
          source: { sourceKind: "manual", sourceRef: "manual:core", excerpt: "Core goal" }
        });
        await service.supersede(db, ids.userA, { factId: write.fact.id });
        return { supersededId: write.fact.id, core: await service.core(db, ids.userA) };
      }
    );

    expect(result.core.items.map((item) => item.id)).not.toContain(result.supersededId);
    expect(result.core.items.length).toBeLessThanOrEqual(20);
  });
});

describe("memory graph API routes", () => {
  it("creates, recalls, pins, supersedes, and forgets owned graph facts", async () => {
    const entity = await graphServer.inject({
      method: "POST",
      url: "/api/memory/graph/entities",
      headers: userAHeaders(),
      payload: {
        kind: "project",
        name: "Route project",
        summary: "Route test memory",
        importance: 0.7,
        pinned: false
      }
    });
    expect(entity.statusCode).toBe(200);
    const entityId = entity.json<{ entity: { id: string } }>().entity.id;

    const fact = await graphServer.inject({
      method: "POST",
      url: "/api/memory/graph/facts",
      headers: userAHeaders(),
      payload: {
        subjectEntityId: entityId,
        predicate: "prefers",
        objectText: `route mobile responses ${randomUUID()}`,
        confidence: 0.92,
        provenance: "confirmed",
        importance: 0.8,
        source: {
          sourceKind: "manual",
          sourceRef: "manual:route-test",
          excerpt: "Route memory excerpt"
        }
      }
    });
    expect(fact.statusCode).toBe(200);
    const factId = fact.json<{ fact: { id: string } }>().fact.id;

    const recall = await graphServer.inject({
      method: "GET",
      url: "/api/memory/graph/recall?q=mobile%20responses",
      headers: userAHeaders()
    });
    expect(recall.statusCode).toBe(200);
    expect(recall.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)).toContain(
      factId
    );

    const core = await graphServer.inject({
      method: "GET",
      url: "/api/memory/graph/core",
      headers: userAHeaders()
    });
    expect(core.statusCode).toBe(200);
    expect(core.json<{ items: unknown[] }>().items.length).toBeLessThanOrEqual(20);

    const pin = await graphServer.inject({
      method: "POST",
      url: `/api/memory/graph/facts/${factId}/pin`,
      headers: userAHeaders(),
      payload: { pinned: true }
    });
    expect(pin.statusCode).toBe(204);

    const supersede = await graphServer.inject({
      method: "POST",
      url: `/api/memory/graph/facts/${factId}/supersede`,
      headers: userAHeaders(),
      payload: {}
    });
    expect(supersede.statusCode).toBe(204);

    const afterSupersede = await graphServer.inject({
      method: "GET",
      url: "/api/memory/graph/recall?q=mobile%20responses",
      headers: userAHeaders()
    });
    expect(
      afterSupersede.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)
    ).not.toContain(factId);
  });

  it("does not let user A forget user B graph memory", async () => {
    const service = new GraphMemoryRecallService(new StubEmbeddingProvider());
    const write = await appDataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "memory-graph:user-b-route" },
      (db) =>
        service.remember(db, ids.userB, {
          predicate: "related_to",
          objectText: "User B graph memory",
          confidence: 0.9,
          provenance: "confirmed",
          importance: 0.8,
          source: { sourceKind: "manual", sourceRef: "manual:user-b", excerpt: "Private B" }
        })
    );

    const res = await graphServer.inject({
      method: "DELETE",
      url: `/api/memory/graph/facts/${write.fact.id}`,
      headers: userAHeaders()
    });

    expect(res.statusCode).toBe(404);
  });
});

async function expectGraphIsolation(
  dataContext: DataContextRunner,
  roleLabel: string
): Promise<void> {
  await seedOtherUserGraph();

  await dataContext.withDataContext(
    { actorUserId: ids.userA, requestId: `memory-graph-rls:${roleLabel}` },
    async (scopedDb) => {
      const userAEntityId = await insertEntity(scopedDb, ids.userA, `${roleLabel} user A`);
      const own = await sql<{ id: string }>`
        SELECT id FROM app.memory_entities WHERE id = ${userAEntityId}::uuid
      `.execute(scopedDb.db);
      expect(own.rows).toEqual([{ id: userAEntityId }]);

      const other = await sql<{ id: string }>`
        SELECT id
        FROM app.memory_entities
        WHERE owner_user_id = ${ids.userB}::uuid
      `.execute(scopedDb.db);
      expect(other.rows).toEqual([]);

      await expect(
        insertEntity(scopedDb, ids.userB, `${roleLabel} wrong owner`)
      ).rejects.toThrow(/row-level security|violates row-level security|permission denied/i);
    }
  );
}

async function resolveAccessContext(request: FastifyRequest) {
  const auth = request.headers.authorization;
  if (auth === "Bearer user-a") return { actorUserId: ids.userA, requestId: "memory-graph-api" };
  if (auth === "Bearer user-b") return { actorUserId: ids.userB, requestId: "memory-graph-api" };
  throw new Error("Unauthorized");
}

function userAHeaders() {
  return { authorization: "Bearer user-a" };
}

async function insertEntity(
  scopedDb: DataContextDb,
  ownerUserId: string,
  name: string
): Promise<string> {
  const inserted = await sql<{ id: string }>`
    INSERT INTO app.memory_entities (owner_user_id, kind, name, summary)
    VALUES (${ownerUserId}::uuid, 'project', ${name}, 'test summary')
    RETURNING id
  `.execute(scopedDb.db);

  return inserted.rows[0]?.id ?? "";
}

async function seedOtherUserGraph(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `
        INSERT INTO app.memory_entities (owner_user_id, kind, name, summary)
        VALUES ($1, 'project', 'User B private graph memory', 'private')
        ON CONFLICT DO NOTHING
      `,
      [ids.userB]
    );
  } finally {
    await client.end();
  }
}
