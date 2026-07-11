import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import {
  DataContextRunner,
  createDatabase,
  createModuleStorageRpc,
  ensureModuleRoles,
  generateModuleTableRlsSql,
  type JarvisDatabase
} from "@jarv1s/db";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const moduleId = "storage-rpc-fixture";

describe("createModuleStorageRpc", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    await ensureModuleRoles(connectionStrings.bootstrap, moduleId);

    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        "CREATE TABLE IF NOT EXISTS app.storage_rpc_fixture_items " +
          "(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL, label text)"
      );
      for (const statement of generateModuleTableRlsSql(moduleId, [
        "app.storage_rpc_fixture_items"
      ])) {
        await client.query(statement);
      }
      await client.query(
        "GRANT jarvis_mod_storage_rpc_fixture_runtime TO jarvis_app_runtime WITH INHERIT FALSE"
      );
    } finally {
      await client.end();
    }

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    dataContext = new DataContextRunner(appDb);
  });

  afterAll(async () => {
    await appDb.destroy();

    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query("REVOKE jarvis_mod_storage_rpc_fixture_runtime FROM jarvis_app_runtime");
      await client.query("DROP TABLE IF EXISTS app.storage_rpc_fixture_items");
      // Revoke the runtime role's grants (sourced from the install role's WITH GRANT OPTION)
      // BEFORE revoking the install role's own — Postgres refuses to revoke a grant-option
      // privilege while a dependent downstream grant still exists.
      await client.query(
        "REVOKE ALL PRIVILEGES ON SCHEMA app FROM jarvis_mod_storage_rpc_fixture_runtime"
      );
      await client.query(
        "REVOKE EXECUTE ON FUNCTION app.current_actor_user_id() FROM jarvis_mod_storage_rpc_fixture_runtime"
      );
      await client.query(
        "REVOKE ALL PRIVILEGES ON SCHEMA app FROM jarvis_mod_storage_rpc_fixture_install"
      );
      await client.query(
        "REVOKE ALL PRIVILEGES ON app.users FROM jarvis_mod_storage_rpc_fixture_install"
      );
      await client.query(
        "REVOKE EXECUTE ON FUNCTION app.current_actor_user_id() FROM jarvis_mod_storage_rpc_fixture_install"
      );
      await client.query("DROP ROLE IF EXISTS jarvis_mod_storage_rpc_fixture_install");
      await client.query("DROP ROLE IF EXISTS jarvis_mod_storage_rpc_fixture_runtime");
    } finally {
      await client.end();
    }
  });

  it("scopes queries to the calling module's runtime role under RLS", async () => {
    const owner = randomUUID();

    await dataContext.withDataContext({ actorUserId: owner }, async (scopedDb) => {
      const rpc = createModuleStorageRpc(scopedDb, moduleId);
      await rpc.query(
        "INSERT INTO app.storage_rpc_fixture_items (owner_user_id, label) VALUES ($1, $2)",
        [owner, "mine"]
      );
      const result = await rpc.query<{ label: string }>(
        "SELECT label FROM app.storage_rpc_fixture_items WHERE owner_user_id = $1",
        [owner]
      );
      expect(result.rows).toEqual([{ label: "mine" }]);
    });

    const other = randomUUID();
    await dataContext.withDataContext({ actorUserId: other }, async (scopedDb) => {
      const rpc = createModuleStorageRpc(scopedDb, moduleId);
      const result = await rpc.query("SELECT label FROM app.storage_rpc_fixture_items");
      expect(result.rows).toEqual([]); // RLS hides the other actor's row
    });
  });
});
