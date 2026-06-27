export const memoryEntityKinds = [
  "person",
  "project",
  "preference",
  "goal",
  "constraint",
  "decision",
  "topic",
  "place",
  "organization",
  "self"
] as const;

export type MemoryEntityKind = (typeof memoryEntityKinds)[number];
export type MemoryEntityStatus = "active" | "archived" | "merged";
export type MemoryFactPredicate =
  | "prefers"
  | "works_on"
  | "has_goal"
  | "has_constraint"
  | "decided"
  | "related_to"
  | "owes"
  | "waiting_on"
  | "mentioned_in"
  | "alias_of";
export type MemoryFactProvenance = "volunteered" | "inferred" | "confirmed" | "imported";
export type MemoryFactStatus = "active" | "superseded" | "rejected";
export type MemoryEpisodeKind = "chat" | "note" | "task" | "email" | "calendar" | "manual";
export type MemorySearchTargetKind = "entity" | "fact" | "episode";

export interface MemoryEntityRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly kind: MemoryEntityKind;
  readonly name: string;
  readonly summary: string;
  readonly status: MemoryEntityStatus;
  readonly importance: number;
  readonly pinned: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MemorySourceInput {
  readonly sourceKind: MemoryEpisodeKind;
  readonly sourceRef: string;
  readonly sourceLabel?: string;
  readonly occurredAt?: Date | null;
  readonly excerpt: string;
}

export interface MemorySourceSummary {
  readonly id: string;
  readonly sourceKind: MemoryEpisodeKind;
  readonly sourceRef: string;
  readonly sourceLabel: string;
  readonly excerpt: string;
  readonly occurredAt: Date | null;
}

export interface MemoryFactRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly subjectEntityId: string;
  readonly predicate: MemoryFactPredicate;
  readonly objectEntityId: string | null;
  readonly objectText: string | null;
  readonly confidence: number;
  readonly provenance: MemoryFactProvenance;
  readonly status: MemoryFactStatus;
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
  readonly lastConfirmedAt: Date | null;
  readonly importance: number;
  readonly pinned: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly sources: readonly MemorySourceSummary[];
}

export interface NewMemoryEntity {
  readonly kind: MemoryEntityKind;
  readonly name: string;
  readonly summary?: string;
  readonly importance?: number;
  readonly pinned?: boolean;
}

export interface NewMemoryFact {
  readonly subjectEntityId: string;
  readonly predicate: MemoryFactPredicate;
  readonly objectEntityId?: string | null;
  readonly objectText?: string | null;
  readonly confidence?: number;
  readonly provenance?: MemoryFactProvenance;
  readonly importance?: number;
  readonly pinned?: boolean;
  readonly source: MemorySourceInput;
}

export interface MemoryAliasRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly entityId: string;
  readonly alias: string;
  readonly normalizedAlias: string;
  readonly ambiguous: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MemorySearchDocumentRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly targetKind: MemorySearchTargetKind;
  readonly targetId: string;
  readonly searchText: string;
  readonly embedModelName: string | null;
  readonly embedModelVersion: string | null;
  readonly status: "active" | "inactive";
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
