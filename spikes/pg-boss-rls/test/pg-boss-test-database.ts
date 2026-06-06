import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { connectionStrings } from "../../auth-rls-safety/test/test-database.js";
import { createPgBoss, RLS_PROBE_QUEUE } from "../src/pg-boss-config.js";

const { Client } = pg;

const spikeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function resetPgBossDatabase(): Promise<void> {
  await dropPgBossSchema();

  const migrationBoss = createPgBoss(connectionStrings.migration, {
    migrate: true,
    createSchema: true
  });

  await migrationBoss.start();
  try {
    await migrationBoss.createQueue(RLS_PROBE_QUEUE, {
      retryLimit: 0,
      deleteAfterSeconds: 60,
      retentionSeconds: 60
    });
  } finally {
    await migrationBoss.stop({ graceful: false });
  }

  await runSqlFile(connectionStrings.migration, "001_pgboss_runtime_grants.sql");
}

async function dropPgBossSchema(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.superuser });

  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS pgboss CASCADE");
  } finally {
    await client.end();
  }
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
