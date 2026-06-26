import type { ColumnType, Selectable } from "kysely";

type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestampColumn = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
type JsonColumn = ColumnType<
  Record<string, unknown>,
  Record<string, unknown> | undefined,
  Record<string, unknown>
>;
type TextArrayColumn = ColumnType<
  string[],
  readonly string[] | string[] | undefined,
  readonly string[] | string[]
>;
type NullableTextArrayColumn = ColumnType<
  string[] | null,
  readonly string[] | string[] | null | undefined,
  readonly string[] | string[] | null
>;
type NullableNumberArrayColumn = ColumnType<
  number[] | null,
  readonly number[] | number[] | null | undefined,
  readonly number[] | number[] | null
>;

export interface SchemaMigrationsTable {
  version: string;
  name: string;
  checksum: string;
  applied_at: TimestampColumn;
}

export interface UsersTable {
  id: string;
  email: string;
  name: string;
  email_verified: boolean;
  image: string | null;
  is_instance_admin: boolean;
  status: "pending" | "active" | "deactivated";
  is_bootstrap_owner: boolean;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface MemberOnboardingTable {
  user_id: string;
  completed_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

/**
 * Provider install/login lifecycle state (#342 Phase 2, install-contract §A.4 / §9.2).
 * One row per provider (instance-global, ADR 0007). `state` mirrors the frozen
 * `ProviderInstallState` enum (packages/shared/src/onboarding-api.ts). Writes are
 * admin-only (0103 RLS); reads are allowed to all authed actors.
 */
export interface ProviderInstallStateTable {
  provider: string;
  state: string;
  version: string | null;
  message: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface AuthSessionsTable {
  id: string;
  user_id: string;
  expires_at: TimestampColumn;
  created_at: TimestampColumn;
}

export interface AuthAccountsTable {
  id: string;
  account_id: string;
  provider_id: string;
  user_id: string;
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
  access_token_expires_at: NullableTimestampColumn;
  refresh_token_expires_at: NullableTimestampColumn;
  scope: string | null;
  password: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface BetterAuthSessionsTable {
  id: string;
  expires_at: TimestampColumn;
  token: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  ip_address: string | null;
  user_agent: string | null;
  user_id: string;
}

export interface AuthVerificationsTable {
  id: string;
  identifier: string;
  value: string;
  expires_at: TimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface SharesTable {
  id: string;
  resource_type: string;
  resource_id: string;
  owner_user_id: string;
  grantee_user_id: string;
  level: ShareLevel;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface InstanceSettingsTable {
  key: string;
  value: JsonColumn;
  updated_by_user_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface AdminAuditEventsTable {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: JsonColumn;
  request_id: string | null;
  created_at: TimestampColumn;
}

export interface ModuleEnablementTable {
  id: ColumnType<string, string | undefined, string>;
  scope: "instance" | "user";
  module_id: string;
  user_id: string | null;
  disabled_by_user_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface RlsProbeItemsTable {
  id: string;
  owner_user_id: string;
  body: string;
  created_at: TimestampColumn;
}

export type TaskStatus = "todo" | "done" | "archived";
export type ShareLevel = "view" | "contribute" | "manage";
export type ConnectorProviderType = "calendar" | "email" | "google";
export type ConnectorProviderStatus = "available" | "disabled";
export type ConnectorAccountStatus = "active" | "error" | "revoked";
export type ConnectorSyncStatus = "success" | "partial" | "failed";
export type AiProviderKind = "openai-compatible" | "anthropic" | "google" | "ollama" | "custom";
export type AiProviderStatus = "active" | "error" | "disabled" | "revoked";
export type AiModelStatus = "active" | "disabled";
export type AiModelTier = "reasoning" | "interactive" | "economy";
export type AiAssistantActionRisk = "write" | "destructive";
export type AiAssistantActionStatus = "pending" | "confirmed" | "rejected" | "cancelled";
export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus = "stored" | "pending" | "blocked" | "no_model" | "working" | "error";
export type BriefingCadence = "manual" | "daily" | "weekly";
export type BriefingRunStatus = "succeeded" | "blocked" | "failed";
export type BriefingRunKind = "manual" | "scheduled";

export interface TasksTable {
  id: string;
  owner_user_id: string;
  list_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number | null;
  position: number;
  due_at: NullableTimestampColumn;
  do_at: NullableTimestampColumn;
  completed_at: NullableTimestampColumn;
  effort: "quick" | "medium" | "large" | null;
  source: string;
  source_ref: string | null;
  external_key: string | null;
  recurrence: Record<string, unknown> | null;
  recurrence_series_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface TaskActivityTable {
  id: string;
  task_id: string;
  actor_user_id: string;
  actor_kind: "user" | "jarvis" | "system";
  activity_type: string;
  body: string | null;
  created_at: TimestampColumn;
}

export interface TaskListsTable {
  id: string;
  owner_user_id: string;
  name: string;
  position: number;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface TaskTagsTable {
  id: string;
  owner_user_id: string;
  list_id: string;
  name: string;
  created_at: TimestampColumn;
}

export interface TaskTagAssignmentsTable {
  task_id: string;
  tag_id: string;
}

export interface TaskPreferencesTable {
  owner_user_id: string;
  default_view: "priority" | "matrix";
  updated_at: TimestampColumn;
}

export interface NotificationsTable {
  id: string;
  actor_user_id: string | null;
  recipient_user_id: string | null;
  title: string;
  body: string | null;
  metadata: JsonColumn;
  created_at: TimestampColumn;
  urgency: ColumnType<string, string | undefined, string>;
  deferred_until: NullableTimestampColumn;
}

export interface NotificationReadsTable {
  notification_id: string;
  user_id: string;
  read_at: TimestampColumn;
}

export interface ConnectorDefinitionsTable {
  provider_id: string;
  provider_type: ConnectorProviderType;
  display_name: string;
  status: ConnectorProviderStatus;
  default_scopes: TextArrayColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface ConnectorAccountsTable {
  id: string;
  provider_id: string;
  owner_user_id: string;
  scopes: TextArrayColumn;
  status: ConnectorAccountStatus;
  encrypted_secret: JsonColumn;
  revoked_at: NullableTimestampColumn;
  last_sync_started_at: NullableTimestampColumn;
  last_sync_finished_at: NullableTimestampColumn;
  last_sync_status: ConnectorSyncStatus | null;
  last_sync_error: string | null;
  last_sync_counts: JsonColumn | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface ConnectorOauthPendingTable {
  id: string;
  owner_user_id: string;
  provider_id: string;
  state: string;
  encrypted_secret: JsonColumn;
  created_at: TimestampColumn;
}

export interface CalendarEventsTable {
  id: string;
  connector_account_id: string;
  owner_user_id: string;
  title: string;
  starts_at: TimestampColumn;
  ends_at: TimestampColumn;
  location: string | null;
  summary: string | null;
  body_excerpt: string | null;
  external_id: string;
  external_metadata: JsonColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface EmailMessagesTable {
  id: string;
  connector_account_id: string;
  owner_user_id: string;
  sender: string;
  recipients: TextArrayColumn;
  subject: string;
  snippet: string | null;
  body_excerpt: string | null;
  received_at: TimestampColumn;
  external_id: string;
  external_metadata: JsonColumn;
  // app.email_messages (Phase 3 connector-sync): LLM-derived triage columns.
  // summary is nullable text; signals is a jsonb object (NOT NULL DEFAULT '{}'),
  // hence JsonColumn so it can be omitted on insert (DB default applies). The full
  // email body is NEVER a column (privacy posture, spec §6).
  summary: string | null;
  signals: JsonColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export type AiAuthMethod = "cli" | "api_key";

export interface AiProviderConfigsTable {
  id: string;
  owner_user_id: string;
  provider_kind: AiProviderKind;
  display_name: string;
  base_url: string | null;
  status: AiProviderStatus;
  auth_method: AiAuthMethod;
  encrypted_credential: JsonColumn;
  revoked_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface AiConfiguredModelsTable {
  id: string;
  provider_config_id: string;
  owner_user_id: string;
  provider_model_id: string;
  display_name: string;
  capabilities: TextArrayColumn;
  status: AiModelStatus;
  tier: AiModelTier;
  allow_user_override: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface AiAssistantActionRequestsTable {
  id: string;
  owner_user_id: string;
  tool_module_id: string;
  tool_module_name: string;
  tool_name: string;
  permission_id: string;
  risk: AiAssistantActionRisk;
  status: AiAssistantActionStatus;
  input_summary: JsonColumn;
  request_id: string | null;
  requested_at: TimestampColumn;
  resolved_at: NullableTimestampColumn;
  updated_at: TimestampColumn;
}

export interface ChatThreadsTable {
  id: string;
  owner_user_id: string;
  title: string;
  incognito: boolean;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  last_active_at: TimestampColumn;
  conversation_summary: string | null;
}

export interface ChatMessagesTable {
  id: string;
  thread_id: string;
  owner_user_id: string;
  role: ChatMessageRole;
  status: ChatMessageStatus;
  body: string;
  model_metadata: JsonColumn;
  tool_metadata: JsonColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface BriefingDefinitionsTable {
  id: string;
  owner_user_id: string;
  title: string;
  cadence: BriefingCadence;
  schedule_metadata: JsonColumn;
  enabled: boolean;
  selected_tool_names: TextArrayColumn;
  last_run_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface BriefingRunsTable {
  id: string;
  definition_id: string;
  owner_user_id: string;
  status: BriefingRunStatus;
  run_kind: BriefingRunKind;
  summary_text: string;
  source_metadata: JsonColumn;
  created_at: TimestampColumn;
}

export interface MemoryChunksTable {
  id: string;
  owner_user_id: string;
  source_kind: "vault" | "connector";
  source_path: string;
  line_start: number;
  line_end: number;
  content_hash: string;
  text: string;
  embedding: string | null; // pgvector stored as text in Kysely; serialized as "[n,n,...]"
  embed_model_name: string | null;
  embed_model_version: string | null;
  updated_at: TimestampColumn;
}

export interface MemoryLinksTable {
  id: string;
  owner_user_id: string;
  from_path: string;
  to_path: string;
}

export interface MemoryFileIndexTable {
  id: string;
  owner_user_id: string;
  source_kind: "vault" | "connector";
  source_path: string;
  file_hash: string;
  chunk_count: number;
  embed_model_name: string;
  embed_model_version: string;
  ingested_at: TimestampColumn;
}

export interface CommitmentsTable {
  id: ColumnType<string, string | undefined, string>;
  owner_user_id: string;
  title: string;
  counterparty: string | null;
  due_at: NullableTimestampColumn;
  status: ColumnType<
    "open" | "at_risk" | "slipped" | "done" | "renegotiated" | "dismissed",
    "open" | "at_risk" | "slipped" | "done" | "renegotiated" | "dismissed" | undefined,
    "open" | "at_risk" | "slipped" | "done" | "renegotiated" | "dismissed"
  >;
  provenance: "volunteered" | "inferred" | "confirmed";
  source_kind: ColumnType<
    "manual" | "inferred" | "email" | "calendar",
    "manual" | "inferred" | "email" | "calendar" | undefined,
    "manual" | "inferred" | "email" | "calendar"
  >;
  source_ref: string | null;
  surfaced_state: string | null;
  life_area: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface EntitiesTable {
  id: ColumnType<string, string | undefined, string>;
  owner_user_id: string;
  type: "person" | "organization" | "account";
  name: string;
  attributes: JsonColumn;
  provenance: "volunteered" | "inferred" | "confirmed";
  vault_note_path: string | null;
  connector_refs: JsonColumn | null;
  life_area: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface PreferencesTable {
  id: ColumnType<string, string | undefined, string>;
  owner_user_id: string;
  key: string;
  value_json: JsonColumn;
  updated_at: TimestampColumn;
}

export type WellnessEmotionCore = "happy" | "sad" | "fear" | "anger" | "disgust" | "surprise";

export interface WellnessCheckinsTable {
  id: ColumnType<string, string | undefined, string>;
  owner_user_id: string;
  checked_in_at: TimestampColumn;
  feeling_core: WellnessEmotionCore;
  feeling_secondary: string | null;
  feeling_tertiary: string | null;
  wheel_version: ColumnType<string, string | undefined, string>;
  sensations: TextArrayColumn;
  intensity: number | null;
  energy: number | null;
  note: string | null;
  identified_via: ColumnType<
    "wheel" | "assisted",
    "wheel" | "assisted" | undefined,
    "wheel" | "assisted"
  >;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export type MedicationFrequencyType =
  | "once_daily"
  | "times_per_day"
  | "specific_weekdays"
  | "every_n_hours"
  | "as_needed"
  | "cyclical";
export type MedicationLogStatus = "taken" | "skipped" | "prn";

export interface MedicationsTable {
  id: ColumnType<string, string | undefined, string>;
  owner_user_id: string;
  name: string;
  dosage: string | null;
  form: string | null;
  frequency_type: MedicationFrequencyType;
  times_per_day: number | null;
  interval_hours: number | null;
  weekdays: NullableNumberArrayColumn;
  schedule_times: NullableTextArrayColumn;
  cycle_days_on: number | null;
  cycle_days_off: number | null;
  cycle_anchor_date: ColumnType<string | null, string | null | undefined, string | null>;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  notes: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface MedicationLogsTable {
  id: ColumnType<string, string | undefined, string>;
  medication_id: string;
  owner_user_id: string;
  status: MedicationLogStatus;
  dose: string | null;
  prn_reason: string | null;
  scheduled_for: NullableTimestampColumn;
  logged_at: TimestampColumn;
  created_at: TimestampColumn;
}

export interface WellnessTherapyNotesTable {
  id: ColumnType<string, string | undefined, string>;
  owner_user_id: string;
  body: string;
  linked_checkin_id: string | null;
  linked_emotion: WellnessEmotionCore | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export type DataExportJobStatus = "pending" | "building" | "ready" | "failed" | "expired";

export type DataExportJobFormat = "json" | "html";

export interface DataExportJobsTable {
  id: ColumnType<string, string | undefined, never>;
  owner_user_id: ColumnType<string, string, never>;
  status: ColumnType<DataExportJobStatus, DataExportJobStatus | undefined, DataExportJobStatus>;
  created_at: TimestampColumn;
  completed_at: TimestampColumn | null;
  expires_at: TimestampColumn | null;
  error_message: string | null;
  format: ColumnType<DataExportJobFormat, DataExportJobFormat | undefined, DataExportJobFormat>;
  params: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | undefined,
    Record<string, unknown> | null
  >;
}

export interface JarvisDatabase {
  "app.schema_migrations": SchemaMigrationsTable;
  "app.users": UsersTable;
  "app.member_onboarding": MemberOnboardingTable;
  "app.provider_install_state": ProviderInstallStateTable;
  "app.auth_sessions": AuthSessionsTable;
  "app.auth_accounts": AuthAccountsTable;
  "app.better_auth_sessions": BetterAuthSessionsTable;
  "app.auth_verifications": AuthVerificationsTable;
  "app.shares": SharesTable;
  "app.instance_settings": InstanceSettingsTable;
  "app.admin_audit_events": AdminAuditEventsTable;
  "app.module_enablement": ModuleEnablementTable;
  "app.rls_probe_items": RlsProbeItemsTable;
  "app.tasks": TasksTable;
  "app.task_activity": TaskActivityTable;
  "app.task_lists": TaskListsTable;
  "app.task_tags": TaskTagsTable;
  "app.task_tag_assignments": TaskTagAssignmentsTable;
  "app.task_preferences": TaskPreferencesTable;
  "app.notifications": NotificationsTable;
  "app.notification_reads": NotificationReadsTable;
  "app.connector_definitions": ConnectorDefinitionsTable;
  "app.connector_accounts": ConnectorAccountsTable;
  "app.connector_oauth_pending": ConnectorOauthPendingTable;
  "app.calendar_events": CalendarEventsTable;
  "app.email_messages": EmailMessagesTable;
  "app.ai_provider_configs": AiProviderConfigsTable;
  "app.ai_configured_models": AiConfiguredModelsTable;
  "app.ai_assistant_action_requests": AiAssistantActionRequestsTable;
  "app.chat_threads": ChatThreadsTable;
  "app.chat_messages": ChatMessagesTable;
  "app.briefing_definitions": BriefingDefinitionsTable;
  "app.briefing_runs": BriefingRunsTable;
  "app.memory_chunks": MemoryChunksTable;
  "app.memory_links": MemoryLinksTable;
  "app.memory_file_index": MemoryFileIndexTable;
  "app.commitments": CommitmentsTable;
  "app.entities": EntitiesTable;
  "app.preferences": PreferencesTable;
  "app.wellness_checkins": WellnessCheckinsTable;
  "app.medications": MedicationsTable;
  "app.medication_logs": MedicationLogsTable;
  "app.wellness_therapy_notes": WellnessTherapyNotesTable;
  "app.data_export_jobs": DataExportJobsTable;
}

export type User = Selectable<UsersTable>;
export type MemberOnboarding = Selectable<MemberOnboardingTable>;
export type Share = Selectable<SharesTable>;
export type InstanceSetting = Selectable<InstanceSettingsTable>;
export type AdminAuditEvent = Selectable<AdminAuditEventsTable>;
export type ModuleEnablementRow = Selectable<ModuleEnablementTable>;
export type RlsProbeItem = Selectable<RlsProbeItemsTable>;
export type Task = Selectable<TasksTable>;
export type TaskActivity = Selectable<TaskActivityTable>;
export type TaskList = Selectable<TaskListsTable>;
export type TaskTag = Selectable<TaskTagsTable>;
export type TaskPreferences = Selectable<TaskPreferencesTable>;
export type Notification = Selectable<NotificationsTable>;
export type NotificationRead = Selectable<NotificationReadsTable>;
export type ConnectorProvider = Selectable<ConnectorDefinitionsTable>;
export type ConnectorAccount = Selectable<ConnectorAccountsTable>;
export type ConnectorOauthPending = Selectable<ConnectorOauthPendingTable>;
export type CalendarEvent = Selectable<CalendarEventsTable>;
export type EmailMessage = Selectable<EmailMessagesTable>;
export type AiProviderConfig = Selectable<AiProviderConfigsTable>;
export type AiConfiguredModel = Selectable<AiConfiguredModelsTable>;
export type AiAssistantActionRequest = Selectable<AiAssistantActionRequestsTable>;
export type ChatThread = Selectable<ChatThreadsTable>;
export type ChatMessage = Selectable<ChatMessagesTable>;
export type BriefingDefinition = Selectable<BriefingDefinitionsTable>;
export type BriefingRun = Selectable<BriefingRunsTable>;
export type JsonObject = JsonColumn;
export type Commitment = Selectable<CommitmentsTable>;
export type Entity = Selectable<EntitiesTable>;
export type Preference = Selectable<PreferencesTable>;
export type WellnessCheckin = Selectable<WellnessCheckinsTable>;
export type Medication = Selectable<MedicationsTable>;
export type MedicationLog = Selectable<MedicationLogsTable>;
export type WellnessTherapyNote = Selectable<WellnessTherapyNotesTable>;
export type DataExportJob = Selectable<DataExportJobsTable>;
