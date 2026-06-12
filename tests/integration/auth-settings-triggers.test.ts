import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import pg from "pg";

import { createDatabase, DataContextRunner } from "@jarv1s/db";
import { connectionStrings, ids, resetEmptyFoundationDatabase } from "./test-database.js";
import { SettingsRepository } from "../../packages/settings/src/repository.js";

// Split out of auth-settings.test.ts to keep each file under the 1000-line limit
// (pnpm check:file-size). These blocks exercise the 0055 users_guard_admin_flag
// trigger and the SettingsRepository withDataContext branding guard directly against
// the database; they share no state with the HTTP-level suites in auth-settings.test.ts.

describe("users_guard_admin_flag trigger (#97)", () => {
  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await seed.connect();
    try {
      await seed.query(
        `INSERT INTO app.users (id, email, name, is_instance_admin)
         VALUES
           ($1, 'trigger-non-admin@test.test', 'Non Admin', false),
           ($2, 'trigger-admin@test.test',     'Admin',     true)`,
        [ids.userA, ids.adminUser]
      );
    } finally {
      await seed.end();
    }
  });

  it("rejects non-admin self-escalation of is_instance_admin", async () => {
    const client = new pg.Client({ connectionString: connectionStrings.app });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      await expect(
        client.query(`UPDATE app.users SET is_instance_admin = true WHERE id = $1`, [ids.userA])
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("allows an active admin to change is_instance_admin on another user", async () => {
    const client = new pg.Client({ connectionString: connectionStrings.app });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.adminUser}'`);
      const result = await client.query(
        `UPDATE app.users SET is_instance_admin = false WHERE id = $1`,
        [ids.userA]
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("allows non-admin to update safe columns on their own row", async () => {
    const client = new pg.Client({ connectionString: connectionStrings.app });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const result = await client.query(
        `UPDATE app.users SET name = 'Updated Name' WHERE id = $1`,
        [ids.userA]
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });
});

describe("users_guard_admin_flag bootstrap exemption (#97)", () => {
  it("allows non-admin self-promotion when no admins exist (single user)", async () => {
    await resetEmptyFoundationDatabase();
    const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await seed.connect();
    try {
      await seed.query(
        `INSERT INTO app.users (id, email, name, is_instance_admin)
         VALUES ($1, 'bootstrap-only@test.test', 'Bootstrap', false)`,
        [ids.userA]
      );
    } finally {
      await seed.end();
    }

    const client = new pg.Client({ connectionString: connectionStrings.app });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const result = await client.query(
        `UPDATE app.users SET is_instance_admin = true WHERE id = $1`,
        [ids.userA]
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("allows non-admin self-promotion when multiple non-admin users exist but no admins", async () => {
    await resetEmptyFoundationDatabase();
    const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await seed.connect();
    try {
      await seed.query(
        `INSERT INTO app.users (id, email, name, is_instance_admin)
         VALUES
           ($1, 'no-admin-a@test.test', 'No Admin A', false),
           ($2, 'no-admin-b@test.test', 'No Admin B', false)`,
        [ids.userA, ids.userB]
      );
    } finally {
      await seed.end();
    }

    const client = new pg.Client({ connectionString: connectionStrings.app });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const result = await client.query(
        `UPDATE app.users SET is_instance_admin = true WHERE id = $1`,
        [ids.userA]
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("withDataContext allows bootstrap owner to set is_instance_admin when no admin exists", async () => {
    // Fresh DB — no users yet, so app.any_admin_exists() is false and the 0055
    // trigger must allow the bootstrap owner's self-promotion.
    await resetEmptyFoundationDatabase();
    const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await seed.connect();
    try {
      await seed.query(
        `INSERT INTO app.users (id, email, name, is_instance_admin)
         VALUES ($1, 'withdc-bootstrap@test.test', 'DC Bootstrap', false)`,
        [ids.userA]
      );
    } finally {
      await seed.end();
    }

    const localDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    const dataContext = new DataContextRunner(localDb);
    try {
      // withDataContext sets app.actor_user_id to the bootstrap owner before the
      // UPDATE fires the 0055 trigger; any_admin_exists() = false → self-promotion allowed.
      await expect(
        dataContext.withDataContext(
          { actorUserId: ids.userA, requestId: "test:bootstrap" },
          async (scopedDb) => {
            await scopedDb.db
              .updateTable("app.users")
              .set({ is_instance_admin: true, updated_at: new Date() })
              .where("id", "=", ids.userA)
              .execute();
          }
        )
      ).resolves.not.toThrow();

      const rows = await sql<{
        is_instance_admin: boolean;
      }>`SELECT is_instance_admin FROM app.get_user_by_id(${ids.userA}::uuid)`.execute(localDb);
      expect(rows.rows[0]?.is_instance_admin).toBe(true);
    } finally {
      // finally so a failed assertion never leaks the connection and hangs the suite.
      await localDb.destroy();
    }
  });
});

describe("SettingsRepository assertDataContextDb guard", () => {
  it("throws 'Repository access requires withDataContext' when passed an unbranded handle", async () => {
    const repo = new SettingsRepository();
    const fakeDb = {} as Parameters<typeof repo.getUserById>[0];
    await expect(repo.getUserById(fakeDb, "any-id")).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(repo.listUsers(fakeDb)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(repo.listInstanceSettings(fakeDb)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(repo.listAdminAuditEvents(fakeDb)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });
});
