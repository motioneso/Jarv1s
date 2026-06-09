import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { getJarvisDatabaseUrls } from "@jarv1s/db";

const { Client } = pg;

const runtimeRoles = [
  "jarvis_app_runtime",
  "jarvis_migration_owner",
  "jarvis_worker_runtime"
] as const;

const protectedTables = [
  "ai_assistant_action_requests",
  "ai_configured_models",
  "ai_provider_configs",
  "briefing_definitions",
  "briefing_runs",
  "calendar_events",
  "chat_messages",
  "chat_threads",
  "connector_accounts",
  "email_messages",
  "notification_reads",
  "notifications",
  "task_activity",
  "tasks"
] as const;

// Transient tables: owner-only RLS required, but runtime DELETE is intentional
// (rows are cleaned up as part of normal operation, e.g. after OAuth completes).
const transientTables = ["connector_oauth_pending"] as const;

export interface AuditReleaseHardeningOptions {
  readonly bootstrapConnectionString?: string;
}

export interface RuntimeRoleAudit {
  readonly bypassRls: boolean;
  readonly canCreateDb: boolean;
  readonly canCreateRole: boolean;
  readonly isSuperuser: boolean;
  readonly roleName: string;
}

export interface ProtectedTableAudit {
  readonly appCanDelete: boolean;
  readonly forceRls: boolean;
  readonly rlsEnabled: boolean;
  readonly tableName: string;
  readonly workerCanDelete: boolean;
}

export interface AdminAuditPrivileges {
  readonly appCanDelete: boolean;
  readonly appCanInsert: boolean;
  readonly appCanSelect: boolean;
  readonly appCanUpdate: boolean;
  readonly workerCanDelete: boolean;
  readonly workerCanInsert: boolean;
  readonly workerCanSelect: boolean;
  readonly workerCanUpdate: boolean;
}

export interface ReleaseHardeningAuditReport {
  readonly adminAuditPrivileges: AdminAuditPrivileges;
  readonly failures: readonly string[];
  readonly passed: boolean;
  readonly protectedTables: readonly ProtectedTableAudit[];
  readonly transientTables: readonly ProtectedTableAudit[];
  readonly roles: readonly RuntimeRoleAudit[];
}

export async function auditReleaseHardening(
  options: AuditReleaseHardeningOptions = {}
): Promise<ReleaseHardeningAuditReport> {
  const client = new Client({
    connectionString: options.bootstrapConnectionString ?? getJarvisDatabaseUrls().bootstrap
  });

  await client.connect();
  try {
    const roles = await readRuntimeRoles(client);
    const tableAudits = await readTableAudits(client, [...protectedTables]);
    const transientTableAudits = await readTableAudits(client, [...transientTables]);
    const adminAuditPrivileges = await readAdminAuditPrivileges(client);
    const failures = collectFailures(roles, tableAudits, transientTableAudits, adminAuditPrivileges);

    return {
      adminAuditPrivileges,
      failures,
      passed: failures.length === 0,
      protectedTables: tableAudits,
      transientTables: transientTableAudits,
      roles
    };
  } finally {
    await client.end();
  }
}

async function readRuntimeRoles(client: pg.Client): Promise<readonly RuntimeRoleAudit[]> {
  const result = await client.query<{
    bypass_rls: boolean;
    can_create_db: boolean;
    can_create_role: boolean;
    is_superuser: boolean;
    role_name: string;
  }>(
    `
      SELECT
        rolname AS role_name,
        rolsuper AS is_superuser,
        rolcreatedb AS can_create_db,
        rolcreaterole AS can_create_role,
        rolbypassrls AS bypass_rls
      FROM pg_roles
      WHERE rolname = ANY($1::text[])
      ORDER BY rolname
    `,
    [[...runtimeRoles]]
  );

  return result.rows.map((row) => ({
    bypassRls: row.bypass_rls,
    canCreateDb: row.can_create_db,
    canCreateRole: row.can_create_role,
    isSuperuser: row.is_superuser,
    roleName: row.role_name
  }));
}

async function readTableAudits(
  client: pg.Client,
  tableNames: readonly string[]
): Promise<readonly ProtectedTableAudit[]> {
  const result = await client.query<{
    app_can_delete: boolean;
    force_rls: boolean;
    rls_enabled: boolean;
    table_name: string;
    worker_can_delete: boolean;
  }>(
    `
      SELECT
        c.relname AS table_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS force_rls,
        has_table_privilege('jarvis_app_runtime', c.oid, 'DELETE') AS app_can_delete,
        has_table_privilege('jarvis_worker_runtime', c.oid, 'DELETE') AS worker_can_delete
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname
    `,
    [[...tableNames]]
  );

  return result.rows.map((row) => ({
    appCanDelete: row.app_can_delete,
    forceRls: row.force_rls,
    rlsEnabled: row.rls_enabled,
    tableName: row.table_name,
    workerCanDelete: row.worker_can_delete
  }));
}

async function readAdminAuditPrivileges(client: pg.Client): Promise<AdminAuditPrivileges> {
  const result = await client.query<AdminAuditPrivileges>(
    `
      SELECT
        has_table_privilege('jarvis_app_runtime', 'app.admin_audit_events', 'SELECT') AS "appCanSelect",
        has_table_privilege('jarvis_app_runtime', 'app.admin_audit_events', 'INSERT') AS "appCanInsert",
        has_table_privilege('jarvis_app_runtime', 'app.admin_audit_events', 'UPDATE') AS "appCanUpdate",
        has_table_privilege('jarvis_app_runtime', 'app.admin_audit_events', 'DELETE') AS "appCanDelete",
        has_table_privilege('jarvis_worker_runtime', 'app.admin_audit_events', 'SELECT') AS "workerCanSelect",
        has_table_privilege('jarvis_worker_runtime', 'app.admin_audit_events', 'INSERT') AS "workerCanInsert",
        has_table_privilege('jarvis_worker_runtime', 'app.admin_audit_events', 'UPDATE') AS "workerCanUpdate",
        has_table_privilege('jarvis_worker_runtime', 'app.admin_audit_events', 'DELETE') AS "workerCanDelete"
    `
  );

  const privileges = result.rows[0];
  if (!privileges) {
    throw new Error("Unable to read admin audit privileges");
  }

  return privileges;
}

function collectFailures(
  roles: readonly RuntimeRoleAudit[],
  tableAudits: readonly ProtectedTableAudit[],
  transientTableAudits: readonly ProtectedTableAudit[],
  adminAuditPrivileges: AdminAuditPrivileges
): readonly string[] {
  const failures: string[] = [];
  const presentRoleNames = new Set(roles.map((role) => role.roleName));
  const presentTableNames = new Set(tableAudits.map((table) => table.tableName));
  const presentTransientNames = new Set(transientTableAudits.map((t) => t.tableName));

  for (const role of runtimeRoles) {
    if (!presentRoleNames.has(role)) {
      failures.push(`missing role: ${role}`);
    }
  }
  for (const role of roles) {
    if (role.isSuperuser) failures.push(`${role.roleName} is superuser`);
    if (role.canCreateDb) failures.push(`${role.roleName} can create databases`);
    if (role.canCreateRole) failures.push(`${role.roleName} can create roles`);
    if (role.bypassRls) failures.push(`${role.roleName} can bypass RLS`);
  }

  for (const table of protectedTables) {
    if (!presentTableNames.has(table)) {
      failures.push(`missing protected table: ${table}`);
    }
  }
  for (const table of tableAudits) {
    if (!table.rlsEnabled) failures.push(`app.${table.tableName} does not enable RLS`);
    if (!table.forceRls) failures.push(`app.${table.tableName} does not force RLS`);
    if (table.appCanDelete) failures.push(`jarvis_app_runtime can DELETE app.${table.tableName}`);
    if (table.workerCanDelete) {
      failures.push(`jarvis_worker_runtime can DELETE app.${table.tableName}`);
    }
  }

  for (const table of transientTables) {
    if (!presentTransientNames.has(table)) {
      failures.push(`missing transient table: ${table}`);
    }
  }
  for (const table of transientTableAudits) {
    if (!table.rlsEnabled) failures.push(`app.${table.tableName} does not enable RLS`);
    if (!table.forceRls) failures.push(`app.${table.tableName} does not force RLS`);
  }

  if (!adminAuditPrivileges.appCanSelect) {
    failures.push("jarvis_app_runtime cannot SELECT app.admin_audit_events");
  }
  if (!adminAuditPrivileges.appCanInsert) {
    failures.push("jarvis_app_runtime cannot INSERT app.admin_audit_events");
  }
  if (adminAuditPrivileges.appCanUpdate) {
    failures.push("jarvis_app_runtime can UPDATE app.admin_audit_events");
  }
  if (adminAuditPrivileges.appCanDelete) {
    failures.push("jarvis_app_runtime can DELETE app.admin_audit_events");
  }
  if (
    adminAuditPrivileges.workerCanSelect ||
    adminAuditPrivileges.workerCanInsert ||
    adminAuditPrivileges.workerCanUpdate ||
    adminAuditPrivileges.workerCanDelete
  ) {
    failures.push("jarvis_worker_runtime has app.admin_audit_events privileges");
  }

  return failures;
}

async function main(): Promise<void> {
  const report = await auditReleaseHardening();

  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
