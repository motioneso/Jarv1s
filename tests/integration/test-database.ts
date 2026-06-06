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
  workspaceAlpha: "20000000-0000-4000-8000-000000000001",
  itemAOwnPrivate: "10000000-0000-4000-8000-000000000001",
  itemBPrivate: "10000000-0000-4000-8000-000000000002",
  itemBGrantedToA: "10000000-0000-4000-8000-000000000003",
  itemBWorkspaceShared: "10000000-0000-4000-8000-000000000004",
  itemBWorkspacePrivate: "10000000-0000-4000-8000-000000000005"
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
        INSERT INTO app.workspaces (id, name, created_by_user_id)
        VALUES ($1, 'Alpha Workspace', $2)
      `,
      [ids.workspaceAlpha, ids.userA]
    );

    await client.query(
      `
        INSERT INTO app.workspace_memberships (user_id, workspace_id, role)
        VALUES ($1, $2, 'member')
      `,
      [ids.userA, ids.workspaceAlpha]
    );

    await client.query(
      `
        INSERT INTO app.rls_probe_items (id, owner_user_id, workspace_id, visibility, body)
        VALUES
          ($1, $2, null, 'private', 'user A private item'),
          ($3, $4, null, 'private', 'user B private item'),
          ($5, $4, null, 'private', 'user B item granted to user A'),
          ($6, $4, $7, 'workspace', 'user B workspace-shared item'),
          ($8, $4, $7, 'private', 'user B private item inside workspace')
      `,
      [
        ids.itemAOwnPrivate,
        ids.userA,
        ids.itemBPrivate,
        ids.userB,
        ids.itemBGrantedToA,
        ids.itemBWorkspaceShared,
        ids.workspaceAlpha,
        ids.itemBWorkspacePrivate
      ]
    );

    await client.query(
      `
        INSERT INTO app.resource_grants (resource_type, resource_id, grantee_user_id, grant_level)
        VALUES ('rls_probe_item', $1, $2, 'view')
      `,
      [ids.itemBGrantedToA, ids.userA]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
