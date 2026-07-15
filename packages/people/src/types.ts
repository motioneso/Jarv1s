export type PersonStatus = "active" | "archived" | "merged";
export type PersonIdentityKind = "email_address" | "source_identity" | "alias" | "display_name";
export type PersonSourceKind =
  | "email"
  | "calendar"
  | "chat"
  | "note"
  | "task"
  | "commitment"
  | "memory"
  | "manual";
export type PersonIdentityStatus = "active" | "pending" | "ambiguous" | "rejected" | "split";
export type PersonProvenance = "source" | "inferred" | "user_confirmed" | "imported";
export type PersonLinkKind =
  | "sender"
  | "recipient"
  | "attendee"
  | "mentioned"
  | "assigned"
  | "counterparty"
  | "related";
export type PersonCandidateKind =
  | "create_person"
  | "link_identity"
  | "merge_people"
  | "split_identity";
export type PersonCandidateStatus = "pending" | "accepted" | "rejected" | "suppressed" | "resolved";
export type PersonEventKind =
  | "created"
  | "identity_linked"
  | "identity_rejected"
  | "merged"
  | "split"
  | "archived"
  | "candidate_accepted"
  | "candidate_rejected"
  | "candidate_reopened";

export interface Person {
  readonly id: string;
  readonly ownerUserId: string;
  readonly displayName: string;
  readonly relationshipSummary: string | null;
  readonly contextSummary: string | null;
  readonly status: PersonStatus;
  readonly confidence: number;
  readonly memoryEntityId: string | null;
  readonly mergedIntoPersonId: string | null;
  readonly archivedAt: Date | null;
  readonly mergedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PersonIdentity {
  readonly id: string;
  readonly ownerUserId: string;
  readonly personId: string | null;
  readonly identityKind: PersonIdentityKind;
  readonly sourceKind: PersonSourceKind;
  readonly displayValue: string;
  readonly sourceRefHash: string | null;
  readonly status: PersonIdentityStatus;
  readonly confidence: number;
  readonly provenance: PersonProvenance;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PersonLink {
  readonly id: string;
  readonly ownerUserId: string;
  readonly personId: string;
  readonly sourceKind: PersonSourceKind;
  readonly sourceRefHash: string;
  readonly sourceLabel: string | null;
  readonly linkKind: PersonLinkKind;
  readonly summary: string | null;
  readonly occurredAt: Date | null;
  readonly sourceUpdatedAt: Date | null;
  readonly confidence: number;
  readonly provenance: PersonProvenance;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PersonLinkSource {
  readonly id: string;
  readonly ownerUserId: string;
  readonly linkId: string;
  readonly identityId: string | null;
  readonly sourceRefHash: string;
  readonly linkKind: PersonLinkKind;
  readonly confidence: number;
  readonly createdAt: Date;
}

export interface MatchCandidate {
  readonly id: string;
  readonly ownerUserId: string;
  readonly candidateKind: PersonCandidateKind;
  readonly status: PersonCandidateStatus;
  readonly primaryPersonId: string | null;
  readonly secondaryPersonId: string | null;
  readonly identityId: string | null;
  readonly suggestedDisplayName: string | null;
  readonly reasonSummary: string | null;
  readonly confidence: number;
  readonly candidateSignature: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PersonEvent {
  readonly id: string;
  readonly ownerUserId: string;
  readonly eventKind: PersonEventKind;
  readonly personId: string | null;
  readonly secondaryPersonId: string | null;
  readonly identityId: string | null;
  readonly candidateId: string | null;
  readonly sourceRefHash: string | null;
  readonly createdAt: Date;
}

export interface PersonIndexingState {
  readonly ownerUserId: string;
  readonly source: PersonSourceKind;
  readonly sourceRefHash: string;
  readonly sourceRef: string;
  readonly lastIndexedAt: Date | null;
  readonly lastSourceVersion: string | null;
  readonly pendingSourceVersion: string | null;
  readonly lastEnqueuedAt: Date | null;
  readonly lastStartedAt: Date | null;
  readonly lastFinishedAt: Date | null;
  readonly failureCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PersonDetail extends Person {
  readonly identities: PersonIdentity[];
  readonly recentLinks: PersonLink[];
}

export interface ListPeopleParams {
  readonly search?: string;
  readonly status?: PersonStatus;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ListLinksParams {
  readonly sourceKind?: PersonSourceKind;
  readonly linkKind?: PersonLinkKind;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface RefreshIndexParams {
  readonly sourceRefs: Array<{
    source: PersonSourceKind;
    sourceRefHash: string;
    sourceVersion?: string;
    reason: string;
  }>;
}

export interface PeopleNotesSettings {
  readonly folder: string | null;
}

export interface PeopleNotesRefreshResult {
  readonly discovered: number;
  readonly projected: number;
  readonly ignored: number;
  readonly candidates: number;
}
