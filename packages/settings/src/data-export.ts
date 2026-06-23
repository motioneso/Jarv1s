import { sql, type Kysely } from "kysely";

import type { DataContextDb, JarvisDatabase } from "@jarv1s/db";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type ExportRow = Record<string, JsonValue>;

export interface ExportUserDataOptions {
  readonly scopedDb: DataContextDb;
  readonly authDb: Kysely<JarvisDatabase>;
  readonly exportedAt?: Date;
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
  readonly chatMemoryFacts: readonly ExportRow[];
  readonly chatMessages: readonly ExportRow[];
  readonly chatThreads: readonly ExportRow[];
  readonly commitments: readonly ExportRow[];
  readonly connectorAccounts: readonly ExportRow[];
  readonly emailMessages: readonly ExportRow[];
  readonly entities: readonly ExportRow[];
  readonly medicationLogs: readonly ExportRow[];
  readonly medications: readonly ExportRow[];
  readonly memoryChunks: readonly ExportRow[];
  readonly notificationReads: readonly ExportRow[];
  readonly notifications: readonly ExportRow[];
  readonly preferences: readonly ExportRow[];
  readonly taskActivity: readonly ExportRow[];
  readonly tasks: readonly ExportRow[];
  readonly users: readonly ExportRow[];
  readonly wellnessCheckins: readonly ExportRow[];
  readonly wellnessTherapyNotes: readonly ExportRow[];
}

export async function exportUserData(options: ExportUserDataOptions): Promise<UserDataExport> {
  const exportedAt = (options.exportedAt ?? new Date()).toISOString();

  return {
    exportedAt,
    userId: options.userId,
    tables: await readExportTables(options.scopedDb, options.authDb, options.userId)
  };
}

async function readExportTables(
  scopedDb: DataContextDb,
  authDb: Kysely<JarvisDatabase>,
  userId: string
): Promise<UserDataExportTables> {
  return {
    users: await readRows(scopedDb.db, userQuery(userId)),
    authAccounts: await readRows(authDb, authAccountsQuery(userId)),
    betterAuthSessions: await readRows(authDb, betterAuthSessionsQuery(userId)),
    tasks: await readRows(scopedDb.db, tasksQuery(userId)),
    taskActivity: await readRows(scopedDb.db, taskActivityQuery(userId)),
    notifications: await readRows(scopedDb.db, notificationsQuery(userId)),
    notificationReads: await readRows(scopedDb.db, notificationReadsQuery(userId)),
    connectorAccounts: await readRows(scopedDb.db, connectorAccountsQuery(userId)),
    calendarEvents: await readRows(scopedDb.db, calendarEventsQuery(userId)),
    emailMessages: await readRows(scopedDb.db, emailMessagesQuery(userId)),
    aiProviderConfigs: await readRows(scopedDb.db, aiProviderConfigsQuery(userId)),
    aiConfiguredModels: await readRows(scopedDb.db, aiConfiguredModelsQuery(userId)),
    aiAssistantActionRequests: await readRows(scopedDb.db, aiAssistantActionRequestsQuery(userId)),
    chatThreads: await readRows(scopedDb.db, chatThreadsQuery(userId)),
    chatMessages: await readRows(scopedDb.db, chatMessagesQuery(userId)),
    briefingDefinitions: await readRows(scopedDb.db, briefingDefinitionsQuery(userId)),
    briefingRuns: await readRows(scopedDb.db, briefingRunsQuery(userId)),
    memoryChunks: await readRows(scopedDb.db, memoryChunksQuery(userId)),
    chatMemoryFacts: await readRows(scopedDb.db, chatMemoryFactsQuery(userId)),
    commitments: await readRows(scopedDb.db, commitmentsQuery(userId)),
    entities: await readRows(scopedDb.db, entitiesQuery(userId)),
    preferences: await readRows(scopedDb.db, preferencesQuery(userId)),
    wellnessCheckins: await readRows(scopedDb.db, wellnessCheckinsQuery(userId)),
    medications: await readRows(scopedDb.db, medicationsQuery(userId)),
    medicationLogs: await readRows(scopedDb.db, medicationLogsQuery(userId)),
    wellnessTherapyNotes: await readRows(scopedDb.db, wellnessTherapyNotesQuery(userId))
  };
}

async function readRows(
  db: Kysely<JarvisDatabase>,
  query: ReturnType<typeof sql<Record<string, unknown>>>
): Promise<ExportRow[]> {
  const result = await query.execute(db);

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

function tasksQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
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

function notificationsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      actor_user_id::text AS "actorUserId",
      recipient_user_id::text AS "recipientUserId",
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
      sender,
      recipients,
      subject,
      snippet,
      body_excerpt AS "bodyExcerpt",
      summary,
      signals,
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

function memoryChunksQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      source_kind AS "sourceKind",
      source_path AS "sourcePath",
      line_start AS "lineStart",
      line_end AS "lineEnd",
      text,
      updated_at AS "updatedAt"
    FROM app.memory_chunks
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY source_path, line_start, id
  `;
}

function chatMemoryFactsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      category,
      content,
      source_thread_id::text AS "sourceThreadId",
      importance,
      status,
      superseded_at AS "supersededAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.chat_memory_facts
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function commitmentsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      title,
      counterparty,
      due_at AS "dueAt",
      status::text,
      provenance::text,
      source_kind::text AS "sourceKind",
      source_ref AS "sourceRef",
      surfaced_state AS "surfacedState",
      life_area AS "lifeArea",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.commitments
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function entitiesQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      type::text,
      name,
      attributes,
      provenance::text,
      vault_note_path AS "vaultNotePath",
      connector_refs AS "connectorRefs",
      life_area AS "lifeArea",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.entities
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function preferencesQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      key,
      value_json AS "valueJson",
      updated_at AS "updatedAt"
    FROM app.preferences
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY key, id
  `;
}

function wellnessCheckinsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      checked_in_at AS "checkedInAt",
      feeling_core::text AS "feelingCore",
      feeling_secondary::text AS "feelingSecondary",
      feeling_tertiary::text AS "feelingTertiary",
      wheel_version AS "wheelVersion",
      sensations,
      intensity,
      energy,
      note,
      identified_via AS "identifiedVia",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.wellness_checkins
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY checked_in_at DESC, id
  `;
}

function medicationsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      name,
      dosage,
      form,
      frequency_type::text AS "frequencyType",
      times_per_day AS "timesPerDay",
      interval_hours AS "intervalHours",
      weekdays,
      schedule_times AS "scheduleTimes",
      cycle_days_on AS "cycleDaysOn",
      cycle_days_off AS "cycleDaysOff",
      cycle_anchor_date::text AS "cycleAnchorDate",
      active,
      notes,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.medications
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function medicationLogsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      medication_id::text AS "medicationId",
      owner_user_id::text AS "ownerUserId",
      status::text,
      dose,
      prn_reason AS "prnReason",
      scheduled_for AS "scheduledFor",
      logged_at AS "loggedAt",
      created_at AS "createdAt"
    FROM app.medication_logs
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY logged_at DESC, id
  `;
}

function wellnessTherapyNotesQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      body,
      linked_checkin_id::text AS "linkedCheckinId",
      linked_emotion::text AS "linkedEmotion",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.wellness_therapy_notes
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at DESC, id
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
