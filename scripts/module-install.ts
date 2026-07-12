// Slice 2 (#914): 4-phase module install entrypoint.
//   Phase A (bootstrap/superuser conn): ensure roles, journal 'installing'.
//   Phase B (installer conn, ONE transaction): apply module DDL + generated RLS/grants.
//   Phase C (migration-owner conn): record ledger rows, flip journal to 'installed'.
//   Phase D (bootstrap/superuser conn): disable installer login, always (finally).
// Recovery model: if the process dies between B and C, a re-run's Phase A finds the journal row
// already 'installing' and unconditionally resets the install role to NOLOGIN (module-role-broker's
// own crash-recovery guard, independent of this file's try/finally). Phase B is re-entered and
// re-applies (idempotent DDL is a module-author responsibility per the wire contract's CREATE
// TABLE/INDEX-only allowlist), and Phase C's ledger insert only runs for migrations
// getAppliedModuleMigrations hasn't already recorded, so a retry never double-applies.
import { Client } from "pg";

import {
  disableInstallerLogin,
  enableInstallerLogin,
  ensureModuleRoles,
  generateModuleTableRlsSql,
  getAppliedModuleMigrations,
  loadModuleMigrationFiles,
  recordModuleMigrations
} from "@jarv1s/db";

export interface ModuleInstallOptions {
  readonly moduleId: string;
  // Structural on purpose (#964): installModule only reads database.ownedTables, and
  // callers hold either the branded JarvisModuleManifest (dev CLI) or the loader's
  // JsonJarvisModuleManifest (boot reconcile). Both satisfy this shape.
  readonly manifest: { readonly database?: { readonly ownedTables?: readonly string[] } };
  readonly bootstrapConnectionString: string;
  readonly migrationConnectionString: string;
  readonly migrationsDirectory: string;
}

export async function installModule(
  options: ModuleInstallOptions
): Promise<{ installed: string[] }> {
  const { moduleId, manifest, bootstrapConnectionString, migrationConnectionString } = options;
  const ownedTables = manifest.database?.ownedTables ?? [];

  // Phase A
  const { runtimeRole, installRole } = await ensureModuleRoles(bootstrapConnectionString, moduleId);
  await journalUpsert(bootstrapConnectionString, {
    moduleId,
    status: "installing",
    tablePrefix: moduleId.replace(/-/g, "_"),
    ownedTables,
    runtimeRole,
    installRole
  });
  const password = await enableInstallerLogin(bootstrapConnectionString, moduleId);

  let installed: string[];
  try {
    // Phase B
    const alreadyApplied = await getAppliedModuleMigrations(migrationConnectionString, moduleId);
    const files = (await loadModuleMigrationFiles(options.migrationsDirectory)).filter(
      (file) => !alreadyApplied.has(file.version)
    );

    const installerConnectionString = withCredentials(
      bootstrapConnectionString,
      installRole,
      password
    );
    const installerClient = new Client({ connectionString: installerConnectionString });
    await installerClient.connect();
    try {
      await installerClient.query("BEGIN");
      for (const file of files) {
        await installerClient.query(file.sql);
      }
      for (const statement of generateModuleTableRlsSql(moduleId, ownedTables)) {
        await installerClient.query(statement);
      }
      await installerClient.query("COMMIT");
    } catch (error) {
      await installerClient.query("ROLLBACK");
      throw error;
    } finally {
      await installerClient.end();
    }

    // Phase C
    if (files.length > 0) {
      await recordModuleMigrations(migrationConnectionString, moduleId, files);
    }
    await journalUpsert(bootstrapConnectionString, {
      moduleId,
      status: "installed",
      tablePrefix: moduleId.replace(/-/g, "_"),
      ownedTables,
      runtimeRole,
      installRole,
      installedAt: new Date()
    });
    installed = files.map((file) => file.name);
  } finally {
    // Phase D — always, success or failure.
    await disableInstallerLogin(bootstrapConnectionString, moduleId);
  }

  return { installed };
}

function withCredentials(connectionString: string, user: string, password: string): string {
  const url = new URL(connectionString);
  url.username = user;
  url.password = password;
  return url.toString();
}

interface JournalRow {
  readonly moduleId: string;
  readonly status: "installing" | "installed" | "failed";
  readonly tablePrefix: string;
  readonly ownedTables: readonly string[];
  readonly runtimeRole: string;
  readonly installRole: string;
  readonly installedAt?: Date;
}

async function journalUpsert(connectionString: string, row: JournalRow): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.module_installs
         (module_id, status, table_prefix, owned_tables, runtime_role, install_role, installed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (module_id) DO UPDATE SET
         status = EXCLUDED.status,
         owned_tables = EXCLUDED.owned_tables,
         installed_at = COALESCE(EXCLUDED.installed_at, app.module_installs.installed_at),
         updated_at = now()`,
      [
        row.moduleId,
        row.status,
        row.tablePrefix,
        row.ownedTables,
        row.runtimeRole,
        row.installRole,
        row.installedAt ?? null
      ]
    );
  } finally {
    await client.end();
  }
}
