import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("module-enablement store (app.module_enablement)", () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("creates the table with the expected columns", async () => {
    const result = await client.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'module_enablement'
        ORDER BY column_name`
    );
    const columns = result.rows.map((r) => r.column_name);
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "scope",
        "module_id",
        "user_id",
        "disabled_by_user_id",
        "created_at",
        "updated_at"
      ])
    );
  });

  it("enforces the scope/user_id consistency check", async () => {
    // scope='instance' must have NULL user_id
    await expect(
      client.query(
        `INSERT INTO app.module_enablement (scope, module_id, user_id) VALUES ('instance', 'x', $1)`,
        ["00000000-0000-4000-8000-000000000099"]
      )
    ).rejects.toThrow();
    // scope='user' must have a non-NULL user_id
    await expect(
      client.query(
        `INSERT INTO app.module_enablement (scope, module_id, user_id) VALUES ('user', 'x', NULL)`
      )
    ).rejects.toThrow();
  });

  it("enforces the partial unique indexes", async () => {
    await client.query(
      `INSERT INTO app.module_enablement (scope, module_id) VALUES ('instance', 'dup-instance')`
    );
    await expect(
      client.query(
        `INSERT INTO app.module_enablement (scope, module_id) VALUES ('instance', 'dup-instance')`
      )
    ).rejects.toThrow();
    await client.query(`DELETE FROM app.module_enablement WHERE module_id = 'dup-instance'`);
  });

  it("FORCE ROW LEVEL SECURITY is enabled", async () => {
    const result = await client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE oid = 'app.module_enablement'::regclass`
    );
    expect(result.rows[0]?.relrowsecurity).toBe(true);
    expect(result.rows[0]?.relforcerowsecurity).toBe(true);
  });
});
