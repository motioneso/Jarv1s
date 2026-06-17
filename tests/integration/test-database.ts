import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getJarvisDatabaseUrls, runSqlFiles, runSqlMigrations } from "@jarv1s/db";
import { migratePgBoss } from "@jarv1s/jobs";
import { getAllQueueDefinitions, getBuiltInSqlMigrationDirectories } from "@jarv1s/module-registry";
import pg from "pg";

const { Client } = pg;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const connectionStrings = getJarvisDatabaseUrls();

export const ids = {
  userA: "00000000-0000-4000-8000-000000000001",
  userB: "00000000-0000-4000-8000-000000000002",
  adminUser: "00000000-0000-4000-8000-000000000003",
  sessionA: "40000000-0000-4000-8000-000000000001",
  sessionB: "40000000-0000-4000-8000-000000000002",
  sessionAdmin: "40000000-0000-4000-8000-000000000003",
  itemAOwnPrivate: "10000000-0000-4000-8000-000000000001",
  itemBPrivate: "10000000-0000-4000-8000-000000000002",
  itemBGrantedToA: "10000000-0000-4000-8000-000000000003",
  itemBSecondPrivate: "10000000-0000-4000-8000-000000000004"
} as const;

export async function resetFoundationDatabase(): Promise<void> {
  await resetEmptyFoundationDatabase();
  await seedProbeData();
}

export async function resetEmptyFoundationDatabase(): Promise<void> {
  await dropApplicationSchemas();
  await runSqlFiles(connectionStrings.bootstrap, join(root, "infra/postgres/bootstrap"));
  await runSqlMigrations({
    connectionString: connectionStrings.migration,
    migrationsDirectory: join(root, "infra/postgres/migrations")
  });
  for (const moduleMigrationsDirectory of getBuiltInSqlMigrationDirectories()) {
    await runSqlMigrations({
      connectionString: connectionStrings.migration,
      migrationsDirectory: moduleMigrationsDirectory
    });
  }
  await migratePgBoss(connectionStrings.migration, getAllQueueDefinitions());
  await runSqlFiles(connectionStrings.migration, join(root, "infra/postgres/grants"));
}

/**
 * Set an instance-wide setting from a test's arrange phase.
 *
 * Writes through the bootstrap superuser connection (same channel as seedProbeData),
 * which bypasses RLS. instance_settings UPDATE is admin-gated by policy (migration
 * 0059); production writes go through an admin DataContext (settings repository), and
 * test setup that only needs to arrange a precondition uses this privileged channel
 * rather than minting an admin actor — mirroring how seedProbeData seeds RLS-protected
 * tables. The value is stored as the jsonb wrapper the settings repository reads.
 */
export async function setInstanceSetting(
  key: string,
  value: Record<string, unknown>
): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query(
      `UPDATE app.instance_settings SET value = $1::jsonb, updated_at = now() WHERE key = $2`,
      [JSON.stringify(value), key]
    );
  } finally {
    await client.end();
  }
}

async function dropApplicationSchemas(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS pgboss CASCADE");
    await client.query("DROP SCHEMA IF EXISTS app CASCADE");
  } finally {
    await client.end();
  }
}

async function seedProbeData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
        INSERT INTO app.users (id, email, is_instance_admin)
        VALUES
          ($1, 'user-a@example.test', false),
          ($2, 'user-b@example.test', false),
          ($3, 'admin@example.test', true)
      `,
      [ids.userA, ids.userB, ids.adminUser]
    );

    await client.query(
      `
        INSERT INTO app.auth_sessions (id, user_id, expires_at)
        VALUES
          ($1, $2, now() + interval '1 hour'),
          ($3, $4, now() + interval '1 hour'),
          ($5, $6, now() + interval '1 hour')
      `,
      [ids.sessionA, ids.userA, ids.sessionB, ids.userB, ids.sessionAdmin, ids.adminUser]
    );

    await client.query(
      `
        INSERT INTO app.rls_probe_items (id, owner_user_id, body)
        VALUES
          ($1, $2, 'user A private item'),
          ($3, $4, 'user B private item'),
          ($5, $4, 'user B item granted to user A'),
          ($6, $4, 'user B second private item')
      `,
      [
        ids.itemAOwnPrivate,
        ids.userA,
        ids.itemBPrivate,
        ids.userB,
        ids.itemBGrantedToA,
        ids.itemBSecondPrivate
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
