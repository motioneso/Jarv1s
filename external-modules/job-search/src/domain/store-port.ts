// external-modules/job-search/src/domain/store-port.ts
//
// Task 13 (#1297): the store's structural contract. No SDK import — handlers (Tasks 15/16)
// unit-test against a fake that implements this interface, never against the SDK runtime.
//
// This interface is CLOSED. No task after this one may call a store method that is not listed
// below. If a later task needs one, it is added here first, with its own test, in the same
// change — a handler written against a method that exists only in its own fake compiles, passes
// its unit test, and fails on the first real invocation.
//
// There is deliberately no `setPortalEnabled`. `PortalState` already carries `enabled`, so
// `setPortalState` is a read-modify-write away; a second method that writes one field of the
// same row is two ways to write the same state, and one of them will drift.
//
// NOTE (ledger N4): Task 5's records.ts deliberately defines no canonical `Profile` type — no
// task needed the full row shape until this one. This file is that canonical definition, not
// records.ts, because records.ts is already closed and committed (Task 5); a second ad-hoc
// shape invented here instead of there would be exactly the drift N4 warns about, so every
// later task must import `Profile`/`ProfileState`/`ProfileContext`/`BriefingDetail`/`Resume`
// from here rather than inventing its own subset.
import type { FailureCause, Match, Posting, PortalState, SearchCriteria } from "./records.js";

/** Mirrors `app.job_search_profiles.state`'s CHECK constraint exactly — do not add or rename a
 * value here without a migration to match. */
export type ProfileState = "in_conversation" | "active" | "paused";

/** Mirrors `app.job_search_profiles.briefing_detail`'s CHECK constraint exactly. The three
 * values are the union Task 16 already defines. */
export type BriefingDetail = "count" | "top" | "full";

/** The broader-context summary distilled from the full-capability conversation (Task 8),
 * written by a user-confirmed tool. Maps 1:1 onto the nullable `context_summary` column: a
 * profile that has never completed that conversation has no context yet, hence `Profile`'s own
 * field stays nullable even though a write always supplies content. */
export type ProfileContext = string;

/** The richest row in the schema (Task 4). Every field a later task might need is here so it is
 * defined once, not re-invented per caller (N4). */
export interface Profile {
  id: string;
  name: string;
  state: ProfileState;
  criteria: SearchCriteria;
  contextSummary: string | null;
  schedule: string | null;
  briefingDetail: BriefingDetail;
  surfaceKey: string;
  createdAt: string;
}

/** One versioned résumé upload (Task 4's `app.job_search_resumes`). */
export interface Resume {
  id: string;
  version: number;
  content: string;
  updatedAt: string;
}

/** `Posting` (Task 5) deliberately has no embedding field — the domain filters and the dedupe
 * never look at vectors. The scoring stage does, and reading the postings and then re-reading
 * their vectors one at a time is a query per posting. Hence one widened row type rather than an
 * optional field on `Posting`. */
export interface PostingWithEmbedding extends Posting {
  readonly embedding: readonly number[];
}

export interface JobSearchStore {
  listProfiles(): Promise<Profile[]>;
  getProfile(id: string): Promise<Profile | null>;
  createProfile(name: string): Promise<Profile>;
  updateCriteria(id: string, criteria: SearchCriteria): Promise<void>;
  setProfileState(profileId: string, state: ProfileState): Promise<void>;
  setProfileContext(profileId: string, context: ProfileContext): Promise<void>;
  setBriefingDetail(profileId: string, detail: BriefingDetail): Promise<void>;
  listPortals(profileId: string): Promise<PortalState[]>;
  setPortalState(profileId: string, state: PortalState): Promise<void>;
  upsertPostings(profileId: string, postings: readonly Posting[]): Promise<Posting[]>;
  setEmbedding(postingId: string, vector: readonly number[]): Promise<void>;
  listUnscored(profileId: string, limit: number): Promise<Posting[]>;
  /** What the scoring stage actually reads. */
  listUnscoredPostingsWithEmbeddings(
    profileId: string,
    limit: number
  ): Promise<PostingWithEmbedding[]>;
  /** `limit` is required, not optional: the SQL binds it as `$2` and the board is a paged
   *  surface. An interface that omits it and a query that binds it is how `$2` ends up
   *  `undefined` at runtime — the driver rejects the statement and every board read 500s. */
  listMatches(profileId: string, limit: number): Promise<Match[]>;
  upsertMatch(profileId: string, match: Omit<Match, "id">): Promise<void>;
  setMatchState(matchId: string, state: Match["state"]): Promise<void>;
  /** The résumé is versioned and first-class (Task 4). `getLatestResume` is what the scoring
   * prompt uses; `getResumeVersion` is what a match pinned to an older version needs, so the
   * board can say which résumé produced a score. */
  getLatestResume(profileId: string): Promise<Resume | undefined>;
  getResumeVersion(profileId: string, version: number): Promise<Resume | undefined>;
  setResume(profileId: string, content: string): Promise<Resume>;
  /** Module KV, not a profile column: the sweep's rotation cursor belongs to the sweep, and it
   * has to survive the profile it happens to be pointing at being deleted. */
  getSweepCursor(): Promise<number>;
  setSweepCursor(index: number): Promise<void>;
}

// Re-exported so callers only need one import site for the shapes this store speaks in.
export type { FailureCause, Match, Posting, PortalState, SearchCriteria };
