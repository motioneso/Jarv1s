import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import pg from "pg";

import {
  createDatabase,
  DataContextRunner,
  type DataContextDb,
  type JarvisDatabase
} from "@jarv1s/db";
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

beforeAll(async () => {
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });
  migrationDb = createDatabase({
    connectionString: connectionStrings.migration,
    maxConnections: 1
  });
  appDataContext = new DataContextRunner(appDb);
  workerDataContext = new DataContextRunner(workerDb);
});

afterAll(async () => {
  await appDb?.destroy();
  await workerDb?.destroy();
  await migrationDb?.destroy();
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
