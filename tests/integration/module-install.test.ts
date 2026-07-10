// tests/integration/module-install.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installModule } from "../../scripts/module-install.js";
import { moduleRuntimeRoleName } from "../../packages/db/src/module-role-broker.js";
import { getJarvisDatabaseUrls } from "../../packages/db/src/urls.js";
import { resetEmptyFoundationDatabase } from "./test-database.js";

const urls = getJarvisDatabaseUrls();
const moduleId = "install-fixture";
let dir: string;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
});

afterEach(async () => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  await client.query("DROP TABLE IF EXISTS app.install_fixture_widgets");
  // ensureModuleRoles grants schema/table-level ACLs to the install role (spec D2); Postgres
  // refuses DROP ROLE while grants are outstanding, so revoke before dropping.
  await client.query("REVOKE ALL PRIVILEGES ON SCHEMA app FROM jarvis_mod_install_fixture_install");
  await client.query("REVOKE ALL PRIVILEGES ON app.users FROM jarvis_mod_install_fixture_install");
  await client.query(`DROP ROLE IF EXISTS jarvis_mod_install_fixture_install`);
  await client.query(`DROP ROLE IF EXISTS jarvis_mod_install_fixture_runtime`);
  await client.query("DELETE FROM app.module_installs WHERE module_id = $1", [moduleId]);
  await client.query("DELETE FROM app.module_schema_migrations WHERE module_id = $1", [moduleId]);
  await client.end();
});

describe("installModule", () => {
  it("applies module DDL, generated RLS, and records the ledger + journal rows", async () => {
    dir = mkdtempSync(join(tmpdir(), "module-install-"));
    writeFileSync(
      join(dir, "0001_create.sql"),
      "CREATE TABLE app.install_fixture_widgets " +
        "(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL);"
    );

    const result = await installModule({
      moduleId,
      manifest: {
        id: moduleId,
        name: "Install Fixture",
        version: "0.0.1",
        publisher: "test",
        lifecycle: "optional",
        compatibility: { jarv1s: ">=0.0.0" },
        availability: { defaultEnabled: false },
        database: { migrations: [], ownedTables: ["app.install_fixture_widgets"] }
      } as any,
      bootstrapConnectionString: urls.bootstrap,
      migrationConnectionString: urls.migration,
      migrationsDirectory: dir
    });

    expect(result.installed).toEqual(["0001_create.sql"]);

    const client = new Client({ connectionString: urls.bootstrap });
    await client.connect();

    const journal = await client.query(
      "SELECT status, owned_tables FROM app.module_installs WHERE module_id = $1",
      [moduleId]
    );
    expect(journal.rows[0].status).toBe("installed");
    expect(journal.rows[0].owned_tables).toEqual(["app.install_fixture_widgets"]);

    const ledger = await client.query(
      "SELECT version FROM app.module_schema_migrations WHERE module_id = $1",
      [moduleId]
    );
    expect(ledger.rows.map((r) => r.version)).toEqual(["0001"]);

    const forceRls = await client.query(
      "SELECT relforcerowsecurity FROM pg_class WHERE oid = 'app.install_fixture_widgets'::regclass"
    );
    expect(forceRls.rows[0].relforcerowsecurity).toBe(true);

    const roleRow = await client.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [
      moduleRuntimeRoleName(moduleId)
    ]);
    expect(roleRow.rows[0].rolcanlogin).toBe(false);
    await client.end();
  });
});
