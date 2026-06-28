import type { ColumnType, Selectable } from "kysely";

type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestampColumn = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

export type PersonContextStatusDb = "active" | "archived" | "merged";
export type PersonContextIdentityKindDb =
  | "email_address"
  | "source_identity"
  | "alias"
  | "display_name";
export type PersonContextSourceKindDb =
  | "email"
  | "calendar"
  | "chat"
  | "note"
  | "task"
  | "commitment"
  | "memory"
  | "manual";
export type PersonContextIdentityStatusDb =
  | "active"
  | "pending"
  | "ambiguous"
  | "rejected"
  | "split";
export type PersonContextProvenanceDb = "source" | "inferred" | "user_confirmed" | "imported";
export type PersonContextLinkKindDb =
  | "sender"
  | "recipient"
  | "attendee"
  | "mentioned"
  | "assigned"
  | "counterparty"
  | "related";
export type PersonContextCandidateKindDb =
  | "create_person"
  | "link_identity"
  | "merge_people"
  | "split_identity";
export type PersonContextCandidateStatusDb =
  | "pending"
  | "accepted"
  | "rejected"
  | "suppressed"
  | "resolved";
export type PersonContextEventKindDb =
  | "created"
  | "identity_linked"
  | "identity_rejected"
  | "merged"
  | "split"
  | "archived"
  | "candidate_accepted"
  | "candidate_rejected"
  | "candidate_reopened";

export interface PersonContextPeopleTable {
  id: ColumnType<string, string | undefined, never>;
  owner_user_id: string;
  display_name: string;
  relationship_summary: string | null;
  context_summary: string | null;
  status: ColumnType<
    PersonContextStatusDb,
    PersonContextStatusDb | undefined,
    PersonContextStatusDb
  >;
  confidence: ColumnType<number, number | undefined, number>;
  memory_entity_id: string | null;
  merged_into_person_id: string | null;
  archived_at: NullableTimestampColumn;
  merged_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface PersonContextIdentitiesTable {
  id: ColumnType<string, string | undefined, never>;
  owner_user_id: string;
  person_id: string | null;
  identity_kind: PersonContextIdentityKindDb;
  source_kind: PersonContextSourceKindDb;
  normalized_value: string;
  display_value: string;
  source_ref: string | null;
  source_ref_hash: string | null;
  status: ColumnType<
    PersonContextIdentityStatusDb,
    PersonContextIdentityStatusDb | undefined,
    PersonContextIdentityStatusDb
  >;
  confidence: ColumnType<number, number | undefined, number>;
  provenance: ColumnType<
    PersonContextProvenanceDb,
    PersonContextProvenanceDb | undefined,
    PersonContextProvenanceDb
  >;
  first_seen_at: TimestampColumn;
  last_seen_at: TimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface PersonContextLinksTable {
  id: ColumnType<string, string | undefined, never>;
  owner_user_id: string;
  person_id: string;
  source_kind: PersonContextSourceKindDb;
  source_ref: string;
  source_ref_hash: string;
  source_label: string | null;
  link_kind: PersonContextLinkKindDb;
  summary: string | null;
  occurred_at: NullableTimestampColumn;
  source_updated_at: NullableTimestampColumn;
  confidence: ColumnType<number, number | undefined, number>;
  provenance: ColumnType<
    PersonContextProvenanceDb,
    PersonContextProvenanceDb | undefined,
    PersonContextProvenanceDb
  >;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface PersonContextLinkSourcesTable {
  id: ColumnType<string, string | undefined, never>;
  owner_user_id: string;
  link_id: string;
  identity_id: string | null;
  source_ref_hash: string;
  link_kind: PersonContextLinkKindDb;
  confidence: ColumnType<number, number | undefined, number>;
  created_at: TimestampColumn;
}

export interface PersonContextMatchCandidatesTable {
  id: ColumnType<string, string | undefined, never>;
  owner_user_id: string;
  candidate_kind: PersonContextCandidateKindDb;
  status: ColumnType<
    PersonContextCandidateStatusDb,
    PersonContextCandidateStatusDb | undefined,
    PersonContextCandidateStatusDb
  >;
  primary_person_id: string | null;
  secondary_person_id: string | null;
  identity_id: string | null;
  suggested_display_name: string | null;
  reason_summary: string | null;
  confidence: ColumnType<number, number | undefined, number>;
  candidate_signature: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface PersonContextEventsTable {
  id: ColumnType<string, string | undefined, never>;
  owner_user_id: string;
  event_kind: PersonContextEventKindDb;
  person_id: string | null;
  secondary_person_id: string | null;
  identity_id: string | null;
  candidate_id: string | null;
  source_ref_hash: string | null;
  created_at: TimestampColumn;
}

export interface PersonContextIndexingStateTable {
  owner_user_id: string;
  source: PersonContextSourceKindDb;
  source_ref_hash: string;
  source_ref: string;
  last_indexed_at: NullableTimestampColumn;
  last_source_version: string | null;
  pending_source_version: string | null;
  last_enqueued_at: NullableTimestampColumn;
  last_started_at: NullableTimestampColumn;
  last_finished_at: NullableTimestampColumn;
  failure_count: ColumnType<number, number | undefined, number>;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export type PersonContextPerson = Selectable<PersonContextPeopleTable>;
export type PersonContextIdentity = Selectable<PersonContextIdentitiesTable>;
export type PersonContextLink = Selectable<PersonContextLinksTable>;
export type PersonContextLinkSource = Selectable<PersonContextLinkSourcesTable>;
export type PersonContextMatchCandidate = Selectable<PersonContextMatchCandidatesTable>;
export type PersonContextEvent = Selectable<PersonContextEventsTable>;
export type PersonContextIndexingState = Selectable<PersonContextIndexingStateTable>;
