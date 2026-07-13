// tests/integration/module-migration-ledger.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  getAppliedModuleMigrations,
  loadModuleMigrationFiles,
  recordModuleMigrations
} from "../../packages/db/src/migrations/module-sql-runner.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

let dir: string;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  const client = new Client({ connectionString: connectionStrings.migration });
  await client.connect();
  await client.query("DELETE FROM app.module_schema_migrations WHERE module_id = 'ledger-fixture'");
  await client.end();
});

describe("loadModuleMigrationFiles", () => {
  it("loads and validates every .sql file in a directory, sorted by version", async () => {
    dir = mkdtempSync(join(tmpdir(), "module-migrations-"));
    writeFileSync(join(dir, "0002_second.sql"), "ALTER TABLE app.a ADD COLUMN b int;");
    writeFileSync(join(dir, "0001_first.sql"), "CREATE TABLE app.a (id uuid PRIMARY KEY);");

    const files = await loadModuleMigrationFiles(dir);

    expect(files.map((f) => f.version)).toEqual(["0001", "0002"]);
    expect(files[0]!.name).toBe("0001_first.sql");
    expect(files[0]!.checksum).toHaveLength(64);
  });

  it("throws with the file name when a file violates the wire contract", async () => {
    dir = mkdtempSync(join(tmpdir(), "module-migrations-"));
    writeFileSync(join(dir, "0001_bad.sql"), "DROP TABLE app.a;");

    await expect(loadModuleMigrationFiles(dir)).rejects.toThrow(/0001_bad\.sql/);
  });

  it("returns [] when the directory doesn't exist (DB-less external module)", async () => {
    dir = mkdtempSync(join(tmpdir(), "module-migrations-"));
    const missing = join(dir, "sql");
    // dir itself is real (so afterEach can rmSync it); "sql" under it is never created.

    await expect(loadModuleMigrationFiles(missing)).resolves.toEqual([]);
  });
});

describe("module migration ledger", () => {
  it("records applied migrations and reports them on the next read", async () => {
    const moduleId = "ledger-fixture";
    const files = [
      { version: "0001", name: "0001_first.sql", checksum: "a".repeat(64), sql: "select 1" }
    ];

    expect(await getAppliedModuleMigrations(connectionStrings.migration, moduleId)).toEqual(
      new Set()
    );

    await recordModuleMigrations(connectionStrings.migration, moduleId, files);

    expect(await getAppliedModuleMigrations(connectionStrings.migration, moduleId)).toEqual(
      new Set(["0001"])
    );
  });
});
