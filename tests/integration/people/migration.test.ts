import { afterAll, beforeAll, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";

import { createDatabase, type JarvisDatabase } from "@jarv1s/db";

import { connectionStrings, resetFoundationDatabase } from "../test-database.js";

let db: Kysely<JarvisDatabase>;

beforeAll(async () => {
  await resetFoundationDatabase();
  db = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
});

afterAll(async () => {
  await db?.destroy();
});

it("migration 0128 creates all person_context tables", async () => {
  const rows = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name LIKE 'person_context_%'
  `.execute(db);
  const names = rows.rows.map((r) => r.table_name).sort();
  expect(names).toEqual([
    "person_context_events",
    "person_context_identities",
    "person_context_indexing_state",
    "person_context_link_sources",
    "person_context_links",
    "person_context_match_candidates",
    "person_context_people"
  ]);
});

it("all person_context tables have RLS enforced", async () => {
  const rows = await sql<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>`SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class JOIN pg_namespace ON relnamespace = pg_namespace.oid
      WHERE nspname = 'app' AND relname LIKE 'person_context_%' AND relkind = 'r'`.execute(db);
  expect(rows.rows.length).toBe(7);
  for (const row of rows.rows) {
    expect(row.relrowsecurity, `${row.relname} relrowsecurity`).toBe(true);
    expect(row.relforcerowsecurity, `${row.relname} relforcerowsecurity`).toBe(true);
  }
});
