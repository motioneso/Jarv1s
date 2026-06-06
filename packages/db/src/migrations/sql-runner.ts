import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import pg from "pg";

const { Client } = pg;

export interface SqlMigrationRunnerOptions {
  readonly connectionString: string;
  readonly migrationsDirectory: string;
  readonly migrationsSchema?: string;
  readonly migrationsTable?: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationRunResult {
  readonly applied: AppliedMigration[];
  readonly skipped: AppliedMigration[];
}

interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly sql: string;
}

export async function runSqlMigrations(
  options: SqlMigrationRunnerOptions
): Promise<MigrationRunResult> {
  const migrationsSchema = options.migrationsSchema ?? "app";
  const migrationsTable = options.migrationsTable ?? "schema_migrations";
  const client = new Client({ connectionString: options.connectionString });
  const files = await readMigrationFiles(options.migrationsDirectory);
  const applied: AppliedMigration[] = [];
  const skipped: AppliedMigration[] = [];
  let lockAcquired = false;

  await client.connect();
  try {
    await acquireMigrationLock(client);
    lockAcquired = true;
    await ensureMigrationTable(client, migrationsSchema, migrationsTable);

    for (const file of files) {
      const existing = await client.query<{ checksum: string }>(
        `
          SELECT checksum
          FROM ${qualifiedIdentifier(migrationsSchema, migrationsTable)}
          WHERE version = $1
        `,
        [file.version]
      );

      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== file.checksum) {
          throw new Error(`Migration ${file.name} has changed after being applied`);
        }

        skipped.push(file);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(file.sql);
        await client.query(
          `
            INSERT INTO ${qualifiedIdentifier(migrationsSchema, migrationsTable)}
              (version, name, checksum)
            VALUES ($1, $2, $3)
          `,
          [file.version, file.name, file.checksum]
        );
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return { applied, skipped };
  } finally {
    if (lockAcquired) {
      await releaseMigrationLock(client);
    }
    await client.end();
  }
}

export async function runSqlFiles(connectionString: string, directory: string): Promise<string[]> {
  const client = new Client({ connectionString });
  const files = await readdir(directory);
  const sqlFiles = files.filter((file) => file.endsWith(".sql")).sort();
  const executed: string[] = [];

  await client.connect();
  try {
    for (const fileName of sqlFiles) {
      const sql = await readFile(join(directory, fileName), "utf8");
      await client.query(sql);
      executed.push(fileName);
    }

    return executed;
  } finally {
    await client.end();
  }
}

async function readMigrationFiles(directory: string): Promise<MigrationFile[]> {
  const files = await readdir(directory);

  return Promise.all(
    files
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map(async (fileName) => {
        const sql = await readFile(join(directory, fileName), "utf8");
        const [version] = fileName.split("_", 1);

        if (!version) {
          throw new Error(`Migration file ${fileName} is missing a version prefix`);
        }

        return {
          version,
          name: basename(fileName),
          checksum: createHash("sha256").update(sql).digest("hex"),
          sql
        };
      })
  );
}

async function ensureMigrationTable(
  client: pg.Client,
  schema: string,
  table: string
): Promise<void> {
  await client.query(
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)} AUTHORIZATION jarvis_migration_owner`
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedIdentifier(schema, table)} (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function acquireMigrationLock(client: pg.Client): Promise<void> {
  await client.query("SELECT pg_advisory_lock(hashtext('jarv1s:migrations'))");
}

async function releaseMigrationLock(client: pg.Client): Promise<void> {
  await client.query("SELECT pg_advisory_unlock(hashtext('jarv1s:migrations'))");
}

function qualifiedIdentifier(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function quoteIdentifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }

  return `"${value}"`;
}
