import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;

beforeAll(async () => {
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app });
  dataContext = new DataContextRunner(appDb);
});

afterAll(async () => {
  await appDb.destroy();
});

describe("email_messages summary/signals columns (0067)", () => {
  it("has nullable summary and a jsonb signals column defaulting to {}", async () => {
    const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'email_messages'
        AND column_name IN ('summary', 'signals')
      ORDER BY column_name
    `.execute(appDb);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    expect(byName.summary?.data_type).toBe("text");
    expect(byName.summary?.is_nullable).toBe("YES");
    expect(byName.signals?.data_type).toBe("jsonb");
    expect(byName.signals?.is_nullable).toBe("NO");
  });

  it("declares a CHECK constraint that pins signals to a jsonb object", async () => {
    // A WHERE-false UPDATE never evaluates a CHECK, so assert the constraint EXISTS in the
    // catalog here; a real rejecting INSERT (signals = '[]') is exercised in C1 where a
    // valid connector account FK is available to reach the row insert at all.
    const checks = await sql<{ definition: string }>`
      SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'app' AND t.relname = 'email_messages' AND c.contype = 'c'
    `.execute(appDb);
    const defs = checks.rows.map((r) => r.definition).join(" | ");
    expect(defs).toMatch(/jsonb_typeof\(signals\)\s*=\s*'object'/);
  });
});
