import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";

import {
  DataContextRunner,
  createDatabase,
  type DataContextDb,
  type JarvisDatabase
} from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

let appDb: Kysely<JarvisDatabase>;
let workerDb: Kysely<JarvisDatabase>;
let migrationDb: Kysely<JarvisDatabase>;
let appDataContext: DataContextRunner;
let workerDataContext: DataContextRunner;

beforeAll(async () => {
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app });
  workerDb = createDatabase({ connectionString: connectionStrings.worker });
  migrationDb = createDatabase({ connectionString: connectionStrings.migration });
  appDataContext = new DataContextRunner(appDb);
  workerDataContext = new DataContextRunner(workerDb);
});

afterAll(async () => {
  await appDb?.destroy();
  await workerDb?.destroy();
  await migrationDb?.destroy();
});

describe("chat_memory_facts RLS runtime roles", () => {
  it("applies the explicit runtime-role policy migration", async () => {
    const migration = await sql<{ name: string }>`
      SELECT name
      FROM app.schema_migrations
      WHERE version = '0094'
    `.execute(migrationDb);

    expect(migration.rows).toEqual([{ name: "0094_chat_memory_facts_rls_roles.sql" }]);
  });

  it("targets all chat_memory_facts policies to the app and worker runtime roles", async () => {
    const policies = await sql<{ policy_name: string; role_name: string }>`
      SELECT p.polname AS policy_name, g.rolname AS role_name
      FROM pg_policy p
      CROSS JOIN LATERAL unnest(p.polroles) AS r(oid)
      JOIN pg_roles g ON g.oid = r.oid
      WHERE p.polrelid = 'app.chat_memory_facts'::regclass
        AND p.polname IN (
          'chat_memory_facts_select',
          'chat_memory_facts_insert',
          'chat_memory_facts_update',
          'chat_memory_facts_delete'
        )
      ORDER BY p.polname, g.rolname
    `.execute(appDb);

    const rolesByPolicy = new Map<string, Set<string>>();
    for (const row of policies.rows) {
      const roles = rolesByPolicy.get(row.policy_name) ?? new Set<string>();
      roles.add(row.role_name);
      rolesByPolicy.set(row.policy_name, roles);
    }

    for (const policyName of [
      "chat_memory_facts_select",
      "chat_memory_facts_insert",
      "chat_memory_facts_update",
      "chat_memory_facts_delete"
    ]) {
      expect(rolesByPolicy.get(policyName)).toEqual(
        new Set(["jarvis_app_runtime", "jarvis_worker_runtime"])
      );
    }
  });

  it("lets jarvis_app_runtime select, insert, update, and delete owned facts", async () => {
    await expectCrudThroughRuntimeRole(appDataContext, "app");
  });

  it("lets jarvis_worker_runtime select, insert, update, and delete owned facts", async () => {
    await expectCrudThroughRuntimeRole(workerDataContext, "worker");
  });
});

async function expectCrudThroughRuntimeRole(
  dataContext: DataContextRunner,
  roleLabel: string
): Promise<void> {
  await dataContext.withDataContext(
    { actorUserId: ids.userA, requestId: `memory-facts-rls:${roleLabel}` },
    async (scopedDb) => {
      const factId = await insertFact(scopedDb, `${roleLabel} runtime fact`);

      const selected = await sql<{ content: string }>`
        SELECT content
        FROM app.chat_memory_facts
        WHERE id = ${factId}
      `.execute(scopedDb.db);
      expect(selected.rows).toEqual([{ content: `${roleLabel} runtime fact` }]);

      const updated = await sql<{ content: string }>`
        UPDATE app.chat_memory_facts
        SET content = ${`${roleLabel} runtime fact updated`}
        WHERE id = ${factId}
        RETURNING content
      `.execute(scopedDb.db);
      expect(updated.rows).toEqual([{ content: `${roleLabel} runtime fact updated` }]);

      const deleted = await sql<{ id: string }>`
        DELETE FROM app.chat_memory_facts
        WHERE id = ${factId}
        RETURNING id
      `.execute(scopedDb.db);
      expect(deleted.rows).toEqual([{ id: factId }]);
    }
  );
}

async function insertFact(scopedDb: DataContextDb, content: string): Promise<string> {
  const inserted = await sql<{ id: string }>`
    INSERT INTO app.chat_memory_facts (owner_user_id, category, content)
    VALUES (${ids.userA}, 'fact', ${content})
    RETURNING id
  `.execute(scopedDb.db);

  return inserted.rows[0]?.id ?? "";
}
