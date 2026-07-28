// external-modules/job-search/src/worker/store-sql.ts
//
// Task 13 (#1297): the ONLY `JobSearchStore` implementation that speaks SQL. Every query here
// runs through `ctx.db.query` — SELECT/INSERT/UPDATE/DELETE only, no `BEGIN`, 5s statement
// timeout, 5000-row/5MiB cap (packages/module-sdk/src/worker.ts). Two rules apply everywhere
// in this file, not just where they are commented:
//
//   1. No method ever binds an actor/owner id. Every write relies on
//      `app.current_actor_user_id()` and every read relies on the generated RLS policy
//      (`packages/db/src/module-rls-emitter.ts:46`) — a method that accepted one could be
//      called with the wrong one.
//   2. Positional `$1`-style params only, and every list method takes an explicit `limit`.
import type {
  BriefingDetail,
  CustomSource,
  JobSearchStore,
  Profile,
  ProfileContext,
  ProfileState,
  PostingWithEmbedding,
  Resume
} from "../domain/store-port.js";
import type {
  FailureCause,
  Match,
  Posting,
  PortalState,
  SearchCriteria
} from "../domain/records.js";
import { withCriteriaDefaults } from "../domain/criteria.js";

interface SqlDb {
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[]
  ): Promise<{ rows: T[] }>;
}

interface SqlKv {
  get(
    scope: "instance" | "user",
    namespace: string,
    key: string
  ): Promise<Record<string, unknown> | null>;
  set(
    scope: "instance" | "user",
    namespace: string,
    key: string,
    value: Record<string, unknown>
  ): Promise<void>;
}

// Module KV, not a profile column (see store-port.ts's comment on getSweepCursor/setSweepCursor):
// the sweep's rotation cursor has to survive the profile it happens to be pointing at being
// deleted. Declared "user" scope only in jarvis.module.json — an "instance" call here would
// throw undeclared_namespace at the host boundary.
const SWEEP_NAMESPACE = "job-search.meta";
const SWEEP_KEY = "sweep-cursor";

// Bounded, not unbounded (see the long comment on setResume below): exhausting this many
// attempts is a real error, not a silent no-op.
const SET_RESUME_MAX_ATTEMPTS = 5;

interface ProfileRow {
  id: string;
  name: string;
  state: string;
  criteria: unknown;
  context_summary: string | null;
  schedule: string | null;
  briefing_detail: string;
  surface_key: string;
  created_at: string;
}

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    state: row.state as ProfileState,
    // The column defaults to '{}'::jsonb for a profile still `in_conversation` — a partial or
    // empty object here is expected, not a mapping bug; nothing in this file validates shape.
    // Hydrated, not cast: `criteria.set` writes a merge of only the fields answered so far, so a
    // profile mid-interview holds a partial object. See `withCriteriaDefaults`.
    criteria: withCriteriaDefaults(row.criteria as Partial<SearchCriteria>),
    contextSummary: row.context_summary,
    schedule: row.schedule,
    briefingDetail: row.briefing_detail as BriefingDetail,
    surfaceKey: row.surface_key,
    createdAt: row.created_at
  };
}

const PROFILE_COLUMNS =
  "id, name, state, criteria, context_summary, schedule, briefing_detail, surface_key, created_at";

interface PostingRow {
  id: string;
  source_id: string;
  external_id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  body: string;
  posted_at: string | null;
}

function mapPosting(row: PostingRow): Posting {
  return {
    id: row.id,
    sourceId: row.source_id,
    externalId: row.external_id,
    title: row.title,
    company: row.company,
    location: row.location,
    url: row.url,
    body: row.body,
    postedAt: row.posted_at
  };
}

// pgvector's `::text` cast renders "[0.1,0.2,...]" — valid JSON, so JSON.parse round-trips it
// without a hand-rolled parser. There is no array binding in either direction (see setEmbedding).
function parseVectorText(text: string): number[] {
  return JSON.parse(text) as number[];
}

function mapPostingWithEmbedding(row: PostingRow & { embedding: string }): PostingWithEmbedding {
  return { ...mapPosting(row), embedding: parseVectorText(row.embedding) };
}

interface MatchRow {
  id: string;
  posting_id: string;
  fit: number | null;
  want: number | null;
  fit_reason: string | null;
  want_reason: string | null;
  outside_frame: boolean;
  state: string;
  scored_at: string | null;
}

// listMatches's join selects posting fields (title, company, location, url, source_id) for the
// board read, but `Match` (records.ts) carries none of them — this store's contract is closed to
// exactly the fields below. `profileId` comes from the call's own argument, not a selected
// column: the query is already scoped `WHERE m.profile_id = $1`, so every row shares it.
function mapMatch(row: MatchRow, profileId: string): Match {
  return {
    id: row.id,
    profileId,
    postingId: row.posting_id,
    fit: row.fit,
    want: row.want,
    // The columns are nullable (no un-scored match has a reason yet); Match's fields are not.
    fitReason: row.fit_reason ?? "",
    wantReason: row.want_reason ?? "",
    outsideFrame: row.outside_frame,
    state: row.state as Match["state"],
    scoredAt: row.scored_at
  };
}

// #1329: listMatches's row, anchored on postings (LEFT JOIN) rather than matches (INNER JOIN),
// so `match_id` and every match-only column are nullable — a posting the scorer hasn't reached
// yet (deferred by triage, unreached against budget/deadline, or a failed parse — score.ts
// leaves all three with no match row on purpose, so the next pass retries them) still produces
// a row here.
interface MatchesReadRow {
  posting_id: string;
  match_id: string | null;
  fit: number | null;
  want: number | null;
  fit_reason: string | null;
  want_reason: string | null;
  outside_frame: boolean | null;
  state: string | null;
  scored_at: string | null;
}

// A synthetic row (no match_id) is never written to `job_search_matches` — see listMatches's own
// comment for why a placeholder INSERT would be a trap. Its `id` is the posting's id: stable, and
// never collides with a real match's id, because the two are mutually exclusive per posting — the
// moment a real match row exists, this same query returns that row (non-null match_id) instead,
// so a posting is never represented by both an id at once.
function mapMatchesReadRow(row: MatchesReadRow, profileId: string): Match {
  if (row.match_id === null) {
    return {
      id: row.posting_id,
      profileId,
      postingId: row.posting_id,
      fit: null,
      want: null,
      fitReason: "",
      wantReason: "",
      outsideFrame: false,
      state: "unscored",
      scoredAt: null
    };
  }
  return {
    id: row.match_id,
    profileId,
    postingId: row.posting_id,
    fit: row.fit,
    want: row.want,
    fitReason: row.fit_reason ?? "",
    wantReason: row.want_reason ?? "",
    outsideFrame: row.outside_frame ?? false,
    state: row.state as Match["state"],
    scoredAt: row.scored_at
  };
}

interface PortalRow {
  source_id: string;
  enabled: boolean;
  last_ok_at: string | null;
  cause: unknown;
}

function mapPortalState(row: PortalRow): PortalState {
  return {
    sourceId: row.source_id,
    enabled: row.enabled,
    lastOkAt: row.last_ok_at,
    cause: (row.cause as FailureCause | null) ?? null
  };
}

interface ResumeRow {
  id: string;
  version: number;
  content: string;
  updated_at: string;
}

function mapResume(row: ResumeRow): Resume {
  return { id: row.id, version: row.version, content: row.content, updatedAt: row.updated_at };
}

// "custom:" is the join key into app.job_search_portals (Task 24, #1309) — a built-in portal's
// source_id ("freehire", "linkedin") never carries this prefix, so the two id spaces never
// collide.
const CUSTOM_SOURCE_ID_PREFIX = "custom:";

interface CustomSourceRow {
  id: string;
  host: string;
  label: string;
  url: string;
  created_at: string;
}

function mapCustomSource(row: CustomSourceRow): CustomSource {
  return {
    id: row.id,
    sourceId: `${CUSTOM_SOURCE_ID_PREFIX}${row.id}`,
    host: row.host,
    label: row.label,
    url: row.url,
    createdAt: row.created_at
  };
}

const SET_RESUME_SQL = `
WITH locked AS (
  SELECT id FROM app.job_search_profiles
   WHERE id = $1 AND owner_user_id = app.current_actor_user_id()
   FOR UPDATE
),
next AS (
  SELECT COALESCE(MAX(r.version), 0) + 1 AS version
    FROM app.job_search_resumes r, locked
   WHERE r.profile_id = locked.id
)
INSERT INTO app.job_search_resumes (owner_user_id, profile_id, version, content)
SELECT app.current_actor_user_id(), locked.id, next.version, $2
  FROM locked, next
ON CONFLICT (owner_user_id, profile_id, version) DO NOTHING
RETURNING id, version, content, updated_at`;

export function createSqlStore(db: SqlDb, kv: SqlKv): JobSearchStore {
  return {
    async listProfiles(): Promise<Profile[]> {
      // DETERMINISTIC ORDER IS PART OF THE CONTRACT: Task 15's sweep persists an index into
      // this list, and `id ASC` breaks ties because `created_at` is not unique under a fast
      // test (or a fast install script creating several profiles in one millisecond).
      const result = await db.query<ProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM app.job_search_profiles ORDER BY created_at ASC, id ASC`
      );
      return result.rows.map(mapProfile);
    },

    async getProfile(id: string): Promise<Profile | null> {
      const result = await db.query<ProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM app.job_search_profiles WHERE id = $1`,
        [id]
      );
      const row = result.rows[0];
      return row ? mapProfile(row) : null;
    },

    async createProfile(name: string): Promise<Profile> {
      const result = await db.query<ProfileRow>(
        `INSERT INTO app.job_search_profiles (owner_user_id, name, state)
         VALUES (app.current_actor_user_id(), $1, 'in_conversation')
         RETURNING ${PROFILE_COLUMNS}`,
        [name]
      );
      const row = result.rows[0];
      if (!row) throw new Error("insert returned no row");
      return mapProfile(row);
    },

    async updateCriteria(id: string, criteria: SearchCriteria): Promise<void> {
      await db.query(
        "UPDATE app.job_search_profiles SET criteria = $2::jsonb, updated_at = now() WHERE id = $1",
        [id, JSON.stringify(criteria)]
      );
    },

    async setProfileState(profileId: string, state: ProfileState): Promise<void> {
      await db.query(
        "UPDATE app.job_search_profiles SET state = $2, updated_at = now() WHERE id = $1",
        [profileId, state]
      );
    },

    async setProfileContext(profileId: string, context: ProfileContext): Promise<void> {
      await db.query(
        "UPDATE app.job_search_profiles SET context_summary = $2, updated_at = now() WHERE id = $1",
        [profileId, context]
      );
    },

    async setBriefingDetail(profileId: string, detail: BriefingDetail): Promise<void> {
      await db.query(
        "UPDATE app.job_search_profiles SET briefing_detail = $2, updated_at = now() WHERE id = $1",
        [profileId, detail]
      );
    },

    async listPortals(profileId: string): Promise<PortalState[]> {
      const result = await db.query<PortalRow>(
        `SELECT source_id, enabled, last_ok_at, cause FROM app.job_search_portals
          WHERE profile_id = $1 ORDER BY source_id ASC`,
        [profileId]
      );
      return result.rows.map(mapPortalState);
    },

    async setPortalState(profileId: string, state: PortalState): Promise<void> {
      // `last_ok_at` uses COALESCE so a failure NEVER erases the last-known-good timestamp —
      // that timestamp is the only thing that lets the degraded strip say how long a board has
      // been down (Task 20; Task 21 case 10 asserts it).
      await db.query(
        `INSERT INTO app.job_search_portals
           (owner_user_id, profile_id, source_id, enabled, last_ok_at, cause, updated_at)
         VALUES (app.current_actor_user_id(), $1, $2, $3, $4, $5::jsonb, now())
         ON CONFLICT (owner_user_id, profile_id, source_id) DO UPDATE
           SET enabled = excluded.enabled,
               last_ok_at = COALESCE(excluded.last_ok_at, app.job_search_portals.last_ok_at),
               cause = excluded.cause, updated_at = now()`,
        [
          profileId,
          state.sourceId,
          state.enabled,
          state.lastOkAt,
          // A bare null must stay a SQL NULL, not the JSON literal "null" — JSON.stringify(null)
          // would cast to a jsonb null value instead of clearing the column.
          state.cause === null ? null : JSON.stringify(state.cause)
        ]
      );
    },

    async upsertPostings(profileId: string, postings: readonly Posting[]): Promise<Posting[]> {
      // One statement per batch, deduped on the natural key (source_id, external_id).
      // `first_seen_at` is NOT in the SET clause below — it is what "new since" means, and
      // refreshing it on every crawl would erase that. `id` is deliberately not sent: it is
      // caller-side-only on a freshly crawled Posting and is not a jsonb_to_recordset column.
      const batch = postings.map((posting) => ({
        source_id: posting.sourceId,
        external_id: posting.externalId,
        title: posting.title,
        company: posting.company,
        location: posting.location,
        url: posting.url,
        body: posting.body,
        posted_at: posting.postedAt
      }));
      const result = await db.query<PostingRow>(
        `INSERT INTO app.job_search_postings
           (owner_user_id, profile_id, source_id, external_id, title, company, location, url,
            body, posted_at)
         SELECT app.current_actor_user_id(), $1, x.source_id, x.external_id, x.title, x.company,
                x.location, x.url, x.body, x.posted_at
           FROM jsonb_to_recordset($2::jsonb) AS x(source_id text, external_id text, title text,
                company text, location text, url text, body text, posted_at timestamptz)
         ON CONFLICT (owner_user_id, profile_id, source_id, external_id) DO UPDATE
           SET title = excluded.title, company = excluded.company, location = excluded.location,
               url = excluded.url, body = excluded.body, posted_at = excluded.posted_at
         RETURNING id, source_id, external_id, title, company, location, url, body, posted_at`,
        [profileId, JSON.stringify(batch)]
      );
      return result.rows.map(mapPosting);
    },

    async setEmbedding(postingId: string, vector: readonly number[]): Promise<void> {
      // `vector` has no JS binding — pass pgvector's text form and cast. A JS array bound
      // directly is a runtime type error, not a silent failure, which is the point.
      await db.query("UPDATE app.job_search_postings SET embedding = $2::vector WHERE id = $1", [
        postingId,
        JSON.stringify([...vector])
      ]);
    },

    async listUnscored(profileId: string, limit: number): Promise<Posting[]> {
      // Same shape as listUnscoredPostingsWithEmbeddings, minus the embedding column/filter:
      // this is the embedding stage's own read, over postings that may not have a vector yet.
      const result = await db.query<PostingRow>(
        `SELECT p.id, p.source_id, p.external_id, p.title, p.company, p.location, p.url, p.body,
                p.posted_at
           FROM app.job_search_postings p
          WHERE p.profile_id = $1
            AND NOT EXISTS (SELECT 1 FROM app.job_search_matches m WHERE m.posting_id = p.id)
          ORDER BY p.first_seen_at DESC
          LIMIT $2`,
        [profileId, limit]
      );
      return result.rows.map(mapPosting);
    },

    async listUnscoredPostingsWithEmbeddings(
      profileId: string,
      limit: number
    ): Promise<PostingWithEmbedding[]> {
      // The scoring stage's ONE read. "Unscored" means "no match row yet" — a NOT EXISTS, not a
      // state column on the posting, so a posting never needs a state of its own to say so.
      const result = await db.query<PostingRow & { embedding: string }>(
        `SELECT p.id, p.source_id, p.external_id, p.title, p.company, p.location, p.url, p.body,
                p.posted_at, p.embedding::text AS embedding
           FROM app.job_search_postings p
          WHERE p.profile_id = $1
            AND p.embedding IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM app.job_search_matches m WHERE m.posting_id = p.id)
          ORDER BY p.first_seen_at DESC
          LIMIT $2`,
        [profileId, limit]
      );
      return result.rows.map(mapPostingWithEmbedding);
    },

    async listMatches(profileId: string, limit: number): Promise<Match[]> {
      // The board read. Both axes stay separate columns all the way through — no expression
      // here may combine fit and want (L9); that invariant is enforced structurally, not by
      // convention.
      //
      // #1329: anchored on POSTINGS with a LEFT JOIN, not on matches with an INNER JOIN. A
      // posting the scorer has not (yet) produced a match row for used to be structurally
      // unreturnable — this crawled-but-not-scored posting is exactly the "unscored" state
      // `records.ts` declares and the board already knows how to render (dashes in both axes),
      // it just never had a producer. The join condition repeats the composite
      // (owner_user_id, profile_id, posting_id) rather than posting_id alone — belt-and-braces
      // against RLS ever widening this read across owners or profiles, even though RLS on both
      // tables already confines every row to the actor's own.
      const result = await db.query<MatchesReadRow>(
        `SELECT p.id AS posting_id, m.id AS match_id, m.fit, m.want, m.fit_reason, m.want_reason,
                m.outside_frame, m.state, m.scored_at
           FROM app.job_search_postings p
           LEFT JOIN app.job_search_matches m
             ON m.owner_user_id = p.owner_user_id
            AND m.profile_id = p.profile_id
            AND m.posting_id = p.id
          WHERE p.profile_id = $1
          ORDER BY m.scored_at DESC NULLS LAST, p.first_seen_at DESC, p.id ASC
          LIMIT $2`,
        [profileId, limit]
      );
      return result.rows.map((row) => mapMatchesReadRow(row, profileId));
    },

    async upsertMatch(profileId: string, match: Omit<Match, "id">): Promise<void> {
      // Idempotent on (profile, posting) so re-scoring updates rather than duplicating.
      // Re-scoring returns the row to 'new' deliberately: a changed score is news.
      await db.query(
        `INSERT INTO app.job_search_matches
           (owner_user_id, profile_id, posting_id, fit, want, fit_reason, want_reason,
            outside_frame, state, scored_at)
         VALUES (app.current_actor_user_id(), $1, $2, $3, $4, $5, $6, $7, 'new', now())
         ON CONFLICT (owner_user_id, profile_id, posting_id) DO UPDATE
           SET fit = excluded.fit, want = excluded.want, fit_reason = excluded.fit_reason,
               want_reason = excluded.want_reason, outside_frame = excluded.outside_frame,
               state = 'new', scored_at = now()`,
        [
          profileId,
          match.postingId,
          match.fit,
          match.want,
          match.fitReason,
          match.wantReason,
          match.outsideFrame
        ]
      );
    },

    async setMatchState(matchId: string, state: Match["state"]): Promise<void> {
      await db.query("UPDATE app.job_search_matches SET state = $2 WHERE id = $1", [
        matchId,
        state
      ]);
    },

    async getMatch(matchId: string): Promise<Match | null> {
      // #1330: the untruncated detail read behind job-search.match.get. By id only, same as
      // setMatchState — RLS confines the row to the actor's own, so a wrong-owner id and a
      // missing id are indistinguishable here, which is correct (neither is this caller's to
      // see). `profile_id` has to be selected explicitly: listMatches's callers already know
      // their own profileId from the call's own argument, but a lookup by bare id doesn't.
      const result = await db.query<MatchRow & { profile_id: string }>(
        `SELECT m.id, m.profile_id, m.posting_id, m.fit, m.want, m.fit_reason, m.want_reason,
                m.outside_frame, m.state, m.scored_at
           FROM app.job_search_matches m
          WHERE m.id = $1`,
        [matchId]
      );
      const row = result.rows[0];
      return row ? mapMatch(row, row.profile_id) : null;
    },

    async getLatestResume(profileId: string): Promise<Resume | undefined> {
      const result = await db.query<ResumeRow>(
        `SELECT id, version, content, updated_at FROM app.job_search_resumes
          WHERE profile_id = $1 ORDER BY version DESC LIMIT 1`,
        [profileId]
      );
      const row = result.rows[0];
      return row ? mapResume(row) : undefined;
    },

    async getResumeVersion(profileId: string, version: number): Promise<Resume | undefined> {
      const result = await db.query<ResumeRow>(
        `SELECT id, version, content, updated_at FROM app.job_search_resumes
          WHERE profile_id = $1 AND version = $2`,
        [profileId, version]
      );
      const row = result.rows[0];
      return row ? mapResume(row) : undefined;
    },

    // Atomic version allocation is a bounded retry loop, not a statement — see the ledger note
    // on this file's task part: `FOR UPDATE` on the parent does not make the MAX(version)
    // aggregate safe under READ COMMITTED (EvalPlanQual only re-evaluates the locked row), and
    // the DB port allows no BEGIN, so a transaction cannot span a read and a write. Each
    // attempt is its own statement and therefore its own fresh snapshot; `ON CONFLICT DO
    // NOTHING RETURNING` turns a lost race into zero rows instead of a thrown unique-violation,
    // which is the retry signal.
    async setResume(profileId: string, content: string): Promise<Resume> {
      for (let attempt = 0; attempt < SET_RESUME_MAX_ATTEMPTS; attempt++) {
        const result = await db.query<ResumeRow>(SET_RESUME_SQL, [profileId, content]);
        const row = result.rows[0];
        if (row) return mapResume(row);

        // Zero rows has two causes that must not be conflated: the profile isn't ours (or
        // doesn't exist), or a concurrent writer won this round. An ownership probe tells them
        // apart — without it a missing profile silently burns all five attempts and reports a
        // phantom concurrency failure instead of the truth.
        const owned = await db.query<{ id: string }>(
          "SELECT id FROM app.job_search_profiles WHERE id = $1",
          [profileId]
        );
        if (owned.rows.length === 0) {
          throw new Error("no such profile");
        }
        // Otherwise a concurrent writer won this round. The next iteration is a fresh
        // statement, so its MAX(version) read sees the winner's now-committed row.
      }
      throw new Error(
        `could not allocate a resume version after ${SET_RESUME_MAX_ATTEMPTS} attempts`
      );
    },

    async getSweepCursor(): Promise<number> {
      const record = await kv.get("user", SWEEP_NAMESPACE, SWEEP_KEY);
      const index = record?.index;
      // Validated on read, not just on write: a hand-edited, half-written, or absent record
      // must degrade to "start at the beginning", never to a NaN that makes rotate() return an
      // empty list and the sweep silently do nothing forever.
      return typeof index === "number" && Number.isInteger(index) && index >= 0 ? index : 0;
    },

    async setSweepCursor(index: number): Promise<void> {
      // The stored value is an object, { index }, never a bare number — ctx.kv is typed
      // Record<string, unknown> in both directions, so a bare number is not storable and would
      // not even typecheck against the real SDK.
      await kv.set("user", SWEEP_NAMESPACE, SWEEP_KEY, { index });
    },

    async listCustomSources(profileId: string): Promise<CustomSource[]> {
      const result = await db.query<CustomSourceRow>(
        `SELECT id, host, label, url, created_at FROM app.job_search_custom_sources
          WHERE profile_id = $1 ORDER BY created_at ASC, id ASC`,
        [profileId]
      );
      return result.rows.map(mapCustomSource);
    },

    async addCustomSource(profileId: string, url: string, label: string): Promise<CustomSource> {
      // The handler (source.add) has already validated `url` is https and its hostname is
      // pinnable; this re-derives the same hostname rather than trusting a second, possibly
      // stale copy of it passed alongside `url`.
      const host = new URL(url).hostname.toLowerCase();
      const result = await db.query<CustomSourceRow>(
        `INSERT INTO app.job_search_custom_sources (owner_user_id, profile_id, host, label, url)
         VALUES (app.current_actor_user_id(), $1, $2, $3, $4)
         RETURNING id, host, label, url, created_at`,
        [profileId, host, label, url]
      );
      const row = result.rows[0];
      if (!row) throw new Error("insert returned no row");
      return mapCustomSource(row);
    },

    async removeCustomSource(profileId: string, sourceId: string): Promise<void> {
      if (!sourceId.startsWith(CUSTOM_SOURCE_ID_PREFIX)) {
        throw new Error(`removeCustomSource: not a custom source id: "${sourceId}"`);
      }
      const id = sourceId.slice(CUSTOM_SOURCE_ID_PREFIX.length);
      // The row that makes the source exist is deleted first; the health row is best-effort
      // second (Constraints, "within job-search's own tables"). A crash between the two leaves
      // an inert orphaned health row — Task 16's portal.list merge only shows a `custom:` id with
      // a matching row here, so the orphan is invisible cruft, never a phantom listing.
      await db.query(
        "DELETE FROM app.job_search_custom_sources WHERE profile_id = $1 AND id = $2",
        [profileId, id]
      );
      await db.query(
        "DELETE FROM app.job_search_portals WHERE profile_id = $1 AND source_id = $2",
        [profileId, sourceId]
      );
    },

    async getPostings(ids: readonly string[]): Promise<Map<string, Posting>> {
      // Short-circuits an empty batch rather than round-tripping the DB: matches.list calls this
      // with the posting ids off whatever page of matches it just read, and an empty page is a
      // real, unexceptional case (a fresh profile with no matches yet).
      if (ids.length === 0) return new Map();
      const result = await db.query<PostingRow>(
        `SELECT id, source_id, external_id, title, company, location, url, body, posted_at
           FROM app.job_search_postings
          WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      return new Map(result.rows.map((row) => [row.id, mapPosting(row)]));
    }
  };
}
