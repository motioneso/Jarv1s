import { describe, expect, it } from "vitest";
import pg from "pg";

import { deleteUserData } from "../../scripts/delete-user-data.js";
import { exportUserData } from "../../scripts/export-user-data.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// #918 Task 26: pins the Task 20 (delete dry-run counts) + Task 21 (export queries)
// entries for app.module_kv / app.module_credentials. Mirrors
// memory-graph-export-delete.test.ts's harness — fixed seeded users (ids.userA/userB)
// via resetFoundationDatabase, direct bootstrap-client seed, exportUserData /
// deleteUserData from the scripts/ wrappers (not the HTTP routes: this is
// lifecycle-script coverage, not route coverage — Task 25 already covers the routes).

const ENVELOPE =
  '{"version":1,"algorithm":"aes-256-gcm","iv":"AA==","tag":"AA==","ciphertext":"AA=="}';

describe("module KV/credential export and delete lifecycle (#918)", () => {
  it("exports only the owning user's rows and deletes them via CASCADE, leaving others untouched", async () => {
    await resetFoundationDatabase();
    await seedModulePlatformRows();

    const userAExport = await exportUserData({
      appConnectionString: connectionStrings.app,
      exportedAt: new Date("2026-07-10T12:00:00.000Z"),
      userId: ids.userA
    });
    const exportedJson = JSON.stringify(userAExport);

    // Export completeness: exactly user A's two KV rows, values intact. Both rows
    // share the same seeded created_at, so id (the ORDER BY tiebreaker) decides
    // return order — assert membership, not position.
    expect(userAExport.tables.moduleKv).toHaveLength(2);
    expect(userAExport.tables.moduleKv).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ moduleId: "kv-fixture", key: "k1", value: "va1" }),
        expect.objectContaining({ moduleId: "kv-fixture", key: "k2", value: "va2" })
      ])
    );
    // The instance-scope row (owner_user_id IS NULL) never appears in any user's export.
    expect(exportedJson).not.toContain('"inst"');
    expect(exportedJson).not.toContain("vb1");

    // Export completeness: exactly one credential row, metadata only — never the envelope.
    expect(userAExport.tables.moduleCredentials).toEqual([
      expect.objectContaining({
        moduleId: "kv-fixture",
        credentialId: "kv-fixture.user-token",
        scope: "user",
        hasSecret: true
      })
    ]);
    expect(exportedJson).not.toContain("ciphertext");

    // Delete dry-run counts: pins Task 20's entries.
    const dryRun = await deleteUserData({
      bootstrapConnectionString: connectionStrings.bootstrap,
      dryRun: true,
      userId: ids.userA
    });
    expect(dryRun.countsBeforeDelete["app.module_credentials"]).toBe(1);
    expect(dryRun.countsBeforeDelete["app.module_kv"]).toBe(2);

    // Real delete: user A's rows CASCADE away; user B's and the instance row survive.
    const deleted = await deleteUserData({
      bootstrapConnectionString: connectionStrings.bootstrap,
      confirmUserId: ids.userA,
      dryRun: false,
      userId: ids.userA
    });
    expect(deleted.deleted).toBe(true);

    const counts = await readModulePlatformCounts();
    expect(counts.userAKv).toBe(0);
    expect(counts.userACredentials).toBe(0);
    expect(counts.userBKv).toBe(1);
    expect(counts.instanceKv).toBe(1);
  });
});

async function seedModulePlatformRows(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO app.module_kv (module_id, namespace, scope, owner_user_id, key, value)
       VALUES ($1, $2, 'user', $3, 'k1', '"va1"'::jsonb),
              ($1, $2, 'user', $3, 'k2', '"va2"'::jsonb),
              ($1, $2, 'user', $4, 'k1', '"vb1"'::jsonb),
              ($1, $2, 'instance', NULL, 'shared', '"inst"'::jsonb)`,
      ["kv-fixture", "kv-fixture.cache", ids.userA, ids.userB]
    );
    await client.query(
      `INSERT INTO app.module_credentials (module_id, credential_id, scope, owner_user_id, display_name, encrypted_secret)
       VALUES ('kv-fixture', 'kv-fixture.user-token', 'user', $1, 'Token', $2::jsonb)`,
      [ids.userA, ENVELOPE]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function readModulePlatformCounts(): Promise<{
  readonly userAKv: number;
  readonly userACredentials: number;
  readonly userBKv: number;
  readonly instanceKv: number;
}> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    const result = await client.query<{
      user_a_kv: string;
      user_a_credentials: string;
      user_b_kv: string;
      instance_kv: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM app.module_kv WHERE owner_user_id = $1::uuid) AS user_a_kv,
          (SELECT count(*) FROM app.module_credentials WHERE owner_user_id = $1::uuid) AS user_a_credentials,
          (SELECT count(*) FROM app.module_kv WHERE owner_user_id = $2::uuid) AS user_b_kv,
          (SELECT count(*) FROM app.module_kv WHERE scope = 'instance') AS instance_kv
      `,
      [ids.userA, ids.userB]
    );
    const row = result.rows[0];
    return {
      userAKv: Number(row?.user_a_kv ?? 0),
      userACredentials: Number(row?.user_a_credentials ?? 0),
      userBKv: Number(row?.user_b_kv ?? 0),
      instanceKv: Number(row?.instance_kv ?? 0)
    };
  } finally {
    await client.end();
  }
}
