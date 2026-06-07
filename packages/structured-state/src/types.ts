export type ProvenanceKind = "volunteered" | "inferred" | "confirmed";
export type CommitmentStatus =
  | "open"
  | "at_risk"
  | "slipped"
  | "done"
  | "renegotiated"
  | "dismissed";
export type CommitmentSourceKind = "manual" | "inferred" | "email" | "calendar";
export type EntityType = "person" | "organization" | "account";
