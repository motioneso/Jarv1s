import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;

const spikeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const host = process.env.SPIKE_PGHOST ?? "localhost";
const port = process.env.SPIKE_PGPORT ?? "55432";
const database = process.env.SPIKE_PGDATABASE ?? "jarv1s_spike";

export const connectionStrings = {
  superuser:
    process.env.SPIKE_SUPERUSER_DATABASE_URL ??
    `postgres://postgres:postgres@${host}:${port}/${database}`,
  migration:
    process.env.SPIKE_MIGRATION_DATABASE_URL ??
    `postgres://jarvis_migration_owner:migration_password@${host}:${port}/${database}`,
  app:
    process.env.SPIKE_APP_DATABASE_URL ??
    `postgres://jarvis_app_runtime:app_password@${host}:${port}/${database}`,
  worker:
    process.env.SPIKE_WORKER_DATABASE_URL ??
    `postgres://jarvis_worker_runtime:worker_password@${host}:${port}/${database}`
};

export const ids = {
  userA: "00000000-0000-4000-8000-000000000001",
  userB: "00000000-0000-4000-8000-000000000002",
  adminUser: "00000000-0000-4000-8000-000000000003",
  sessionA: "40000000-0000-4000-8000-000000000001",
  sessionAdmin: "40000000-0000-4000-8000-000000000003",
  workspaceAlpha: "20000000-0000-4000-8000-000000000001",
  itemAOwnPrivate: "10000000-0000-4000-8000-000000000001",
  itemBPrivate: "10000000-0000-4000-8000-000000000002",
  itemBGrantedToA: "10000000-0000-4000-8000-000000000003",
  itemBWorkspaceShared: "10000000-0000-4000-8000-000000000004",
  itemBWorkspacePrivate: "10000000-0000-4000-8000-000000000005",
  jobForUserA: "30000000-0000-4000-8000-000000000001"
} as const;

export async function resetSpikeDatabase(): Promise<void> {
  await runSqlFile(connectionStrings.superuser, "000_roles.sql");
  await runSqlFile(connectionStrings.migration, "001_schema.sql");
  await runSqlFile(connectionStrings.migration, "002_rls.sql");
  await seedProbeData();
}

async function runSqlFile(connectionString: string, fileName: string): Promise<void> {
  const client = new Client({ connectionString });
  const sql = await readFile(join(spikeRoot, "sql", fileName), "utf8");

  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function seedProbeData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.superuser });

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
          ($3, $4, now() + interval '1 hour')
      `,
      [ids.sessionA, ids.userA, ids.sessionAdmin, ids.adminUser]
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

    await client.query(
      `
        INSERT INTO app.spike_jobs (id, actor_user_id, workspace_id, payload)
        VALUES ($1, $2, null, '{"kind":"probe"}'::jsonb)
      `,
      [ids.jobForUserA, ids.userA]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
