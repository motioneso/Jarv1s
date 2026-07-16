/**
 * #1025: the level ladder from spec §4.3 — each level is additive over the
 * previous one (admin+data = solo-admin + feature chunks; multi-user adds a
 * second user + cross-user fixtures on top of admin+data). Not four independent
 * seed files.
 */
export type UatSeedLevel = "bare" | "solo-admin" | "admin+data" | "multi-user";

// #1087 finding 5: canonical enum values, single source of truth for
// tests/uat/seed/level-validation.ts's fail-closed parsers — kept next to the
// type union itself so the two can never drift apart.
export const UAT_SEED_LEVELS: readonly UatSeedLevel[] = [
  "bare",
  "solo-admin",
  "admin+data",
  "multi-user"
];

/** #1025 spec §4.4: per-feature chunk list seeded at admin+data and above. */
export type UatSeedChunk = "news" | "sports" | "tasks" | "calendar" | "notes" | "job-search";

// #1087 finding 5: canonical chunk names accepted in excludeChunks — see
// UAT_SEED_LEVELS above for why this lives beside the type.
export const UAT_SEED_CHUNKS: readonly UatSeedChunk[] = [
  "news",
  "sports",
  "tasks",
  "calendar",
  "notes",
  "job-search"
];

export interface SeedOptions {
  readonly level: UatSeedLevel;
  /** #1025: e.g. omit "job-search" to prove the absent-module UI path. */
  readonly excludeChunks?: readonly UatSeedChunk[];
}
