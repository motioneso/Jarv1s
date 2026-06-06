import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sql } from "kysely";

import {
  DataContextRunner,
  createDatabase,
  getJarvisDatabaseUrls,
  type DataContextDb
} from "@jarv1s/db";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type ExportRow = Record<string, JsonValue>;

export interface ExportUserDataOptions {
  readonly appConnectionString?: string;
  readonly exportedAt?: Date;
  readonly outputFile?: string;
  readonly userId: string;
}

export interface UserDataExport {
  readonly exportedAt: string;
  readonly tables: UserDataExportTables;
  readonly userId: string;
}

export interface UserDataExportTables {
  readonly aiAssistantActionRequests: readonly ExportRow[];
  readonly aiConfiguredModels: readonly ExportRow[];
  readonly aiProviderConfigs: readonly ExportRow[];
  readonly authAccounts: readonly ExportRow[];
  readonly betterAuthSessions: readonly ExportRow[];
  readonly briefingDefinitions: readonly ExportRow[];
  readonly briefingRuns: readonly ExportRow[];
  readonly calendarEvents: readonly ExportRow[];
  readonly chatMessages: readonly ExportRow[];
  readonly chatThreads: readonly ExportRow[];
  readonly connectorAccounts: readonly ExportRow[];
  readonly emailMessages: readonly ExportRow[];
  readonly notes: readonly ExportRow[];
  readonly notificationReads: readonly ExportRow[];
  readonly notifications: readonly ExportRow[];
  readonly resourceGrants: readonly ExportRow[];
  readonly taskActivity: readonly ExportRow[];
  readonly tasks: readonly ExportRow[];
  readonly users: readonly ExportRow[];
  readonly workspaceMemberships: readonly ExportRow[];
}

export async function exportUserData(options: ExportUserDataOptions): Promise<UserDataExport> {
  const db = createDatabase({
    connectionString: options.appConnectionString ?? getJarvisDatabaseUrls().app,
    maxConnections: 1
  });

  try {
    const dataContext = new DataContextRunner(db);
    const exportedAt = (options.exportedAt ?? new Date()).toISOString();

    return await dataContext.withDataContext(
      {
        actorUserId: options.userId,
        requestId: `maintenance:user-export:${exportedAt}`
      },
      async (scopedDb) => ({
        exportedAt,
        userId: options.userId,
        tables: await readExportTables(scopedDb, options.userId)
      })
    );
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.userId) {
    throw new Error("Usage: pnpm export:user -- --user-id <uuid> [--output exports/user.json]");
  }

  const outputFile = args.output ?? defaultExportFile(args.userId, new Date());
  const userExport = await exportUserData({
    outputFile,
    userId: args.userId
  });

  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(userExport, null, 2)}\n`, "utf8");
  console.log(`Wrote sensitive user export to ${outputFile}`);
}

async function readExportTables(
  scopedDb: DataContextDb,
  userId: string
): Promise<UserDataExportTables> {
  return {
    users: await readRows(scopedDb, userQuery(userId)),
    authAccounts: await readRows(scopedDb, authAccountsQuery(userId)),
    betterAuthSessions: await readRows(scopedDb, betterAuthSessionsQuery(userId)),
    workspaceMemberships: await readRows(scopedDb, workspaceMembershipsQuery(userId)),
    resourceGrants: await readRows(scopedDb, resourceGrantsQuery(userId)),
    tasks: await readRows(scopedDb, tasksQuery(userId)),
    taskActivity: await readRows(scopedDb, taskActivityQuery(userId)),
    notes: await readRows(scopedDb, notesQuery(userId)),
    notifications: await readRows(scopedDb, notificationsQuery(userId)),
    notificationReads: await readRows(scopedDb, notificationReadsQuery(userId)),
    connectorAccounts: await readRows(scopedDb, connectorAccountsQuery(userId)),
    calendarEvents: await readRows(scopedDb, calendarEventsQuery(userId)),
    emailMessages: await readRows(scopedDb, emailMessagesQuery(userId)),
    aiProviderConfigs: await readRows(scopedDb, aiProviderConfigsQuery(userId)),
    aiConfiguredModels: await readRows(scopedDb, aiConfiguredModelsQuery(userId)),
    aiAssistantActionRequests: await readRows(scopedDb, aiAssistantActionRequestsQuery(userId)),
    chatThreads: await readRows(scopedDb, chatThreadsQuery(userId)),
    chatMessages: await readRows(scopedDb, chatMessagesQuery(userId)),
    briefingDefinitions: await readRows(scopedDb, briefingDefinitionsQuery(userId)),
    briefingRuns: await readRows(scopedDb, briefingRunsQuery(userId))
  };
}

async function readRows(
  scopedDb: DataContextDb,
  query: ReturnType<typeof sql<Record<string, unknown>>>
): Promise<ExportRow[]> {
  const result = await query.execute(scopedDb.db);

  return result.rows.map(normalizeRow);
}

function userQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      email,
      name,
      email_verified AS "emailVerified",
      image,
      is_instance_admin AS "isInstanceAdmin",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.users
    WHERE id = ${userId}::uuid
    ORDER BY id
  `;
}

function authAccountsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      account_id AS "accountId",
      provider_id AS "providerId",
      user_id::text AS "userId",
      scope,
      access_token IS NOT NULL AS "hasAccessToken",
      refresh_token IS NOT NULL AS "hasRefreshToken",
      id_token IS NOT NULL AS "hasIdToken",
      password IS NOT NULL AS "hasPassword",
      access_token_expires_at AS "accessTokenExpiresAt",
      refresh_token_expires_at AS "refreshTokenExpiresAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.auth_accounts
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function betterAuthSessionsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      user_id::text AS "userId",
      expires_at AS "expiresAt",
      ip_address AS "ipAddress",
      user_agent AS "userAgent",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.better_auth_sessions
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function workspaceMembershipsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      user_id::text AS "userId",
      workspace_id::text AS "workspaceId",
      role,
      created_at AS "createdAt"
    FROM app.workspace_memberships
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at, workspace_id
  `;
}

function resourceGrantsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      resource_type AS "resourceType",
      resource_id::text AS "resourceId",
      grantee_user_id::text AS "granteeUserId",
      grant_level AS "grantLevel",
      granted_by_user_id::text AS "grantedByUserId",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.resource_grants
    WHERE grantee_user_id = ${userId}::uuid
      OR granted_by_user_id = ${userId}::uuid
    ORDER BY created_at, resource_type, resource_id
  `;
}

function tasksQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      workspace_id::text AS "workspaceId",
      visibility::text,
      title,
      description,
      status::text,
      priority,
      due_at AS "dueAt",
      completed_at AS "completedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.tasks
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function taskActivityQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      activity.id::text AS id,
      activity.task_id::text AS "taskId",
      activity.actor_user_id::text AS "actorUserId",
      activity.activity_type AS "activityType",
      activity.body,
      activity.created_at AS "createdAt"
    FROM app.task_activity activity
    JOIN app.tasks task ON task.id = activity.task_id
    WHERE task.owner_user_id = ${userId}::uuid
    ORDER BY activity.created_at, activity.id
  `;
}

function notesQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      workspace_id::text AS "workspaceId",
      visibility::text,
      title,
      body,
      archived_at AS "archivedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.notes
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function notificationsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      actor_user_id::text AS "actorUserId",
      recipient_user_id::text AS "recipientUserId",
      workspace_id::text AS "workspaceId",
      visibility::text,
      title,
      body,
      metadata,
      created_at AS "createdAt"
    FROM app.notifications
    WHERE recipient_user_id = ${userId}::uuid
      OR actor_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function notificationReadsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      notification_id::text AS "notificationId",
      user_id::text AS "userId",
      read_at AS "readAt"
    FROM app.notification_reads
    WHERE user_id = ${userId}::uuid
    ORDER BY read_at, notification_id
  `;
}

function connectorAccountsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      provider_id AS "providerId",
      owner_user_id::text AS "ownerUserId",
      workspace_id::text AS "workspaceId",
      scopes,
      status::text,
      encrypted_secret IS NOT NULL AS "hasSecret",
      revoked_at AS "revokedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.connector_accounts
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function calendarEventsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      connector_account_id::text AS "connectorAccountId",
      owner_user_id::text AS "ownerUserId",
      workspace_id::text AS "workspaceId",
      visibility::text,
      title,
      starts_at AS "startsAt",
      ends_at AS "endsAt",
      location,
      summary,
      body_excerpt AS "bodyExcerpt",
      external_id AS "externalId",
      external_metadata AS "externalMetadata",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.calendar_events
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY starts_at, id
  `;
}

function emailMessagesQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      connector_account_id::text AS "connectorAccountId",
      owner_user_id::text AS "ownerUserId",
      workspace_id::text AS "workspaceId",
      visibility::text,
      sender,
      recipients,
      subject,
      snippet,
      body_excerpt AS "bodyExcerpt",
      received_at AS "receivedAt",
      external_id AS "externalId",
      external_metadata AS "externalMetadata",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.email_messages
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY received_at, id
  `;
}

function aiProviderConfigsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      provider_kind::text AS "providerKind",
      display_name AS "displayName",
      base_url AS "baseUrl",
      status::text,
      encrypted_credential IS NOT NULL AS "hasCredential",
      revoked_at AS "revokedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.ai_provider_configs
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function aiConfiguredModelsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      provider_config_id::text AS "providerConfigId",
      owner_user_id::text AS "ownerUserId",
      provider_model_id AS "providerModelId",
      display_name AS "displayName",
      capabilities,
      status::text,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.ai_configured_models
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function aiAssistantActionRequestsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      workspace_id::text AS "workspaceId",
      tool_module_id AS "toolModuleId",
      tool_module_name AS "toolModuleName",
      tool_name AS "toolName",
      permission_id AS "permissionId",
      risk,
      status::text,
      input_summary AS "inputSummary",
      request_id AS "requestId",
      requested_at AS "requestedAt",
      resolved_at AS "resolvedAt",
      updated_at AS "updatedAt"
    FROM app.ai_assistant_action_requests
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY requested_at, id
  `;
}

function chatThreadsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      workspace_id::text AS "workspaceId",
      visibility::text,
      title,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.chat_threads
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function chatMessagesQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      thread_id::text AS "threadId",
      owner_user_id::text AS "ownerUserId",
      workspace_id::text AS "workspaceId",
      visibility::text,
      role::text,
      status::text,
      body,
      model_metadata AS "modelMetadata",
      tool_metadata AS "toolMetadata",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.chat_messages
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function briefingDefinitionsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      workspace_id::text AS "workspaceId",
      visibility::text,
      title,
      cadence::text,
      schedule_metadata AS "scheduleMetadata",
      enabled,
      selected_tool_names AS "selectedToolNames",
      last_run_at AS "lastRunAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.briefing_definitions
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function briefingRunsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      definition_id::text AS "definitionId",
      owner_user_id::text AS "ownerUserId",
      workspace_id::text AS "workspaceId",
      visibility::text,
      status::text,
      run_kind::text AS "runKind",
      summary_text AS "summaryText",
      source_metadata AS "sourceMetadata",
      created_at AS "createdAt"
    FROM app.briefing_runs
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function normalizeRow(row: Record<string, unknown>): ExportRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])
  ) as ExportRow;
}

function normalizeValue(value: unknown): JsonValue {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        normalizeValue(nested)
      ])
    );
  }
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  return String(value);
}

function defaultExportFile(userId: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");

  return `exports/jarv1s-user-${userId}-${stamp}.json`;
}

function parseArgs(args: readonly string[]): {
  readonly output?: string;
  readonly userId?: string;
} {
  return {
    output: readFlag(args, "--output"),
    userId: readFlag(args, "--user-id")
  };
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
