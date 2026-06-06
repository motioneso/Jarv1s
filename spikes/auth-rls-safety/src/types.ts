import type { ColumnType, Selectable } from "kysely";

type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
type JsonColumn = ColumnType<
  Record<string, unknown>,
  Record<string, unknown> | string | undefined,
  Record<string, unknown> | string
>;

export interface UsersTable {
  id: string;
  email: string;
  is_instance_admin: boolean;
  created_at: TimestampColumn;
}

export interface AuthSessionsTable {
  id: string;
  user_id: string;
  expires_at: TimestampColumn;
  created_at: TimestampColumn;
}

export interface WorkspaceMembershipsTable {
  user_id: string;
  workspace_id: string;
  role: string;
  created_at: TimestampColumn;
}

export interface ResourceGrantsTable {
  resource_type: string;
  resource_id: string;
  grantee_user_id: string;
  grant_level: "view" | "contribute" | "manage";
  created_at: TimestampColumn;
}

export interface RlsProbeItemsTable {
  id: string;
  owner_user_id: string;
  workspace_id: string | null;
  visibility: "private" | "workspace";
  body: string;
  created_at: TimestampColumn;
}

export interface SpikeJobsTable {
  id: string;
  actor_user_id: string;
  workspace_id: string | null;
  payload: JsonColumn;
  status: "queued" | "running" | "done" | "failed";
  created_at: TimestampColumn;
}

export interface SpikeDatabase {
  "app.users": UsersTable;
  "app.auth_sessions": AuthSessionsTable;
  "app.workspace_memberships": WorkspaceMembershipsTable;
  "app.resource_grants": ResourceGrantsTable;
  "app.rls_probe_items": RlsProbeItemsTable;
  "app.spike_jobs": SpikeJobsTable;
}

export type RlsProbeItem = Selectable<RlsProbeItemsTable>;
