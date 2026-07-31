## Phase 4 — Worker

### Task 13: Worker skeleton, ports, and input validation

**Depends on:** Task 4 (tables), Task 5 (records), Task 11 (`FetchLike`).

**Files**

- Read first: `external-modules/finance/src/worker/ports.ts`, `index.ts`, and its validator
- Create: `external-modules/job-search/src/worker/{index.ts,ports.ts,validate.ts,store-sql.ts}`
- Create: `external-modules/job-search/src/domain/store-port.ts`
- Test: `tests/unit/job-search-validate.test.ts`
- Test: `tests/unit/job-search-fetch-bridge.test.ts`
- Test: `tests/integration/job-search-store.test.ts` — the store against a real database, **before**
  any handler depends on it

**Contracts**

```ts
// worker/validate.ts
/** The host spreads actorUserId onto every external tool input as an anti-spoof measure
 * (FIN-04). It is deliberate and it is not going away, so every strict validator in this
 * module strips it before checking for unknown keys. */
export function stripEnvelope(raw: unknown): Record<string, unknown>;
export function validateProfileInput(raw: unknown): { profileId: string };
```

```ts
// worker/ports.ts
export function toFetchLike(ctx: ModuleWorkerContext): FetchLike;
```

```ts
// domain/store-port.ts — structural, no SDK import, so handlers unit-test with a fake.

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
```

**This interface is closed.** No task after this one may call a store method that is not listed. If a
later task needs one, it is added here first, with its own test, in the same change — a handler
written against a method that exists only in its own fake compiles, passes its unit test, and fails
on the first real invocation.

There is deliberately **no `setPortalEnabled`**. `PortalState` already carries `enabled`, so
`setPortalState` is a read-modify-write away; a second method that writes one field of the same row
is two ways to write the same state, and one of them will drift.

**Constraints on the fetch bridge** (`ctx.fetch` is not WHATWG fetch, and the adapters must never
learn that it isn't)

- `ctx.fetch` takes **one** object (`ModuleFetchRequest`) and resolves `{status, headers,
bodyBase64}` — `packages/module-sdk/src/index.ts:682-694`. No `ok`, no `text()`; the body is base64
  because the host reads it as an ArrayBuffer (`worker-rpc-host.ts:149`).
- Only four response headers survive — `content-type`, `content-length`, `last-modified`, `etag`
  (`worker-rpc-host.ts:143`). **`set-cookie` is dropped**, so no adapter can hold a session. That is
  consistent with the rule that a portal demanding login stops rather than signing in; it also means
  no adapter may be written to depend on one.
- A missing or non-matching `fetchHosts` entry is an `invalid_rpc` **throw**, not a status code.
  Callers must treat a rejection as a `network` cause, never as "zero postings found".
- Redirects are followed inside the host's fetch; the adapter sees only the final status.
- Decode the body eagerly. It is already fully in memory as base64, so a lazy `text()` buys nothing
  and only moves a decode failure somewhere harder to attribute.

**Constraints the SDK imposes on every store method** — not stylistic

1. **`ctx.db.query` allows exactly SELECT / INSERT / UPDATE / DELETE** (`packages/module-sdk/src/worker.ts:57-69`).
   There is no `BEGIN`, so **there are no multi-statement transactions**. Anything that must be
   atomic has to be one statement — a CTE, an `INSERT … SELECT`, or an `ON CONFLICT`.
2. **Never pass an actor id.** Every write sets `owner_user_id = app.current_actor_user_id()`, and
   no read filters on owner at all — the generated RLS policy already does
   (`packages/db/src/module-rls-emitter.ts:46`; the function is EXECUTE-granted to the runtime role
   at `:40`). A store method that accepts an `ownerUserId` argument is a store method that can be
   called with the wrong one.
3. **Positional `$1` params only.** Results are capped at 5000 rows / 5 MiB with a 5 s statement
   timeout, so every list method takes an explicit `limit`.
4. **`vector` has no JS binding.** Pass the embedding as pgvector's text form and cast — `$2::vector`
   with `JSON.stringify([...vector])`. A JS array is a runtime type error; a float array bound as
   `text` without the cast silently stores nothing usable. Reads come back as `embedding::text` and
   are parsed in JS — there is no array binding on the way out either.

**SQL contracts** (verbatim; the ones that are not a one-line `SELECT … WHERE id = $1`)

```sql
-- listProfiles — DETERMINISTIC ORDER IS PART OF THE CONTRACT. Task 15's sweep persists an INDEX
-- into this list, so an unstable order makes the cursor point at a different profile each sweep
-- and the rotation silently degenerates into random selection.
SELECT id, name, state, criteria, context_summary, schedule, briefing_detail, surface_key,
       created_at
  FROM app.job_search_profiles
 ORDER BY created_at ASC, id ASC   -- id breaks ties: created_at is not unique under a fast test
```

```sql
-- upsertPostings — one statement per batch, deduped on the natural key. Returns the stored rows so
-- the caller learns which were new without a second read. `first_seen_at` is NOT touched on
-- conflict: it is what "new since" means, and refreshing it on every crawl erases that.
INSERT INTO app.job_search_postings
  (owner_user_id, profile_id, source_id, external_id, title, company, location, url, body, posted_at)
SELECT app.current_actor_user_id(), $1, x.source_id, x.external_id, x.title, x.company,
       x.location, x.url, x.body, x.posted_at
  FROM jsonb_to_recordset($2::jsonb) AS x(source_id text, external_id text, title text,
       company text, location text, url text, body text, posted_at timestamptz)
ON CONFLICT (owner_user_id, profile_id, source_id, external_id) DO UPDATE
  SET title = excluded.title, company = excluded.company, location = excluded.location,
      url = excluded.url, body = excluded.body, posted_at = excluded.posted_at
RETURNING id, source_id, external_id, title, company, location, url, body, posted_at, first_seen_at
```

```sql
-- setEmbedding — the cast is the whole point.
UPDATE app.job_search_postings SET embedding = $2::vector WHERE id = $1
```

```sql
-- listUnscoredPostingsWithEmbeddings — the scoring stage's ONE read. Unscored means "no match row
-- yet", which is a NOT EXISTS, not a state column on the posting.
SELECT p.id, p.source_id, p.external_id, p.title, p.company, p.location, p.url, p.body,
       p.posted_at, p.first_seen_at, p.embedding::text AS embedding
  FROM app.job_search_postings p
 WHERE p.profile_id = $1
   AND p.embedding IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM app.job_search_matches m WHERE m.posting_id = p.id)
 ORDER BY p.first_seen_at DESC
 LIMIT $2   -- hits job_search_postings_profile_idx
```

```sql
-- listMatches — the board read. One join, both axes as separate columns, and NO expression that
-- combines them; a `(fit + want)` anywhere in this file is the product invariant breaking at the
-- last place it can still be caught structurally.
SELECT m.id, m.posting_id, m.fit, m.want, m.fit_reason, m.want_reason, m.outside_frame, m.state,
       m.scored_at, p.title, p.company, p.location, p.url, p.source_id
  FROM app.job_search_matches m
  JOIN app.job_search_postings p ON p.id = m.posting_id
 WHERE m.profile_id = $1
 ORDER BY m.scored_at DESC NULLS LAST, m.id ASC
 LIMIT $2   -- hits job_search_matches_board_idx
```

```sql
-- upsertMatch — idempotent on (profile, posting) so re-scoring updates rather than duplicating.
-- Re-scoring returns the row to `new` deliberately: a changed score is news.
INSERT INTO app.job_search_matches
  (owner_user_id, profile_id, posting_id, fit, want, fit_reason, want_reason, outside_frame,
   state, scored_at)
VALUES (app.current_actor_user_id(), $1, $2, $3, $4, $5, $6, $7, 'new', now())
ON CONFLICT (owner_user_id, profile_id, posting_id) DO UPDATE
  SET fit = excluded.fit, want = excluded.want, fit_reason = excluded.fit_reason,
      want_reason = excluded.want_reason, outside_frame = excluded.outside_frame,
      state = 'new', scored_at = now()
```

```sql
-- setPortalState — the whole row, one statement. `last_ok_at` uses COALESCE so a failure NEVER
-- erases the last-known-good timestamp; that timestamp is the only thing that lets the degraded
-- strip say how long a board has been down (Task 20; Task 21 case 10 asserts it).
INSERT INTO app.job_search_portals
  (owner_user_id, profile_id, source_id, enabled, last_ok_at, cause, updated_at)
VALUES (app.current_actor_user_id(), $1, $2, $3, $4, $5::jsonb, now())
ON CONFLICT (owner_user_id, profile_id, source_id) DO UPDATE
  SET enabled = excluded.enabled,
      last_ok_at = COALESCE(excluded.last_ok_at, app.job_search_portals.last_ok_at),
      cause = excluded.cause, updated_at = now()
```

```sql
-- getLatestResume
SELECT id, version, content, updated_at FROM app.job_search_resumes
 WHERE profile_id = $1 ORDER BY version DESC LIMIT 1
```

**`setResume` — atomic version allocation. This one is a bounded retry loop, not a statement.**

```sql
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
RETURNING id, version, content, updated_at
```

```ts
const SET_RESUME_MAX_ATTEMPTS = 5;
```

Why it is a loop, before anyone "simplifies" it back:

- `INSERT … SELECT COALESCE(MAX(version),0)+1` **races**. Under READ COMMITTED both concurrent
  statements read the same MAX before either inserts, both compute the same next version, and the
  UNIQUE constraint turns the second upload into a user-visible error.
- **`FOR UPDATE` on the parent does not fix it, and this is the trap.** Blocking on a row lock does
  not give the waiting statement a new snapshot. Postgres re-evaluates the *locked row* after the
  lock is released (EvalPlanQual), but the aggregate over `app.job_search_resumes` is a different
  relation and keeps the snapshot taken when the statement began — before the wait. The lock changes
  the timing and hides the bug in casual testing; it does not remove it.
- The DB port allows no `BEGIN`, so we cannot hold a transaction across a read and a write. What we
  can do is make each **attempt** a fresh statement, and therefore a fresh snapshot, and let the
  unique constraint arbitrate. `ON CONFLICT DO NOTHING RETURNING` means a loser returns **zero rows**
  instead of throwing: that is the signal to try again, and the next attempt's MAX sees the winner's
  committed row.
- The retry is **bounded**. An unbounded loop under a pathological writer is a worker that burns its
  whole invocation deadline on one upload. Exhausting the five attempts is a real error, not a
  silent no-op — swallowing it would hand the caller a résumé that was never stored.
- **Zero rows has two causes and they must not be conflated.** Either `locked` was empty (the profile
  does not exist or is not ours — retrying will never help) or we lost the version race. Distinguish
  them with an ownership probe, or a missing profile spins five times and then reports a phantom
  concurrency failure. The missing-profile message says "no such profile", not anything about
  contention.
- The `locked` CTE stays. It is no longer load-bearing for correctness, but it scopes the write to a
  profile the actor owns in the same statement and collapses the common two-writer case into one
  retry instead of a thundering herd. It **must be referenced** by the insert (it is, in the `FROM`)
  — Postgres does not guarantee an unreferenced CTE runs at all.

**The sweep cursor is `ctx.kv`, not SQL.** Namespace `job-search.meta` (declared in Task 3's
manifest), key `sweep-cursor`. **The stored value is an object, `{ index: number }` — not a bare JSON
number**: `ctx.kv.get`/`set` are typed `Record<string, unknown>` in both directions
(`packages/module-sdk/src/worker.ts:20`), so a bare number is not storable and does not typecheck.
Validate on **read** as well as write — a hand-edited or half-written record must degrade to "start
at the beginning", never to a `NaN` that makes `rotate()` return an empty list and the sweep silently
do nothing forever. Absent key returns `0`; a fresh install starting at profile zero is correct, not
an error.

`index.ts` is `defineModuleWorker({handlers})` with an empty handler map. Tasks 15 and 16 fill it.

**Tests — validator** (`tests/unit/job-search-validate.test.ts`)

1. **Strips the host-injected `actorUserId` instead of rejecting the call.** The host spreads
   `actorUserId` onto every external tool input; a strict unknown-key validator that does not strip
   it kills every call with `unknown key: actorUserId`.
2. **Still rejects a genuinely unknown key** (`unknown key: sneaky`). Fails against a validator that
   "fixed" case 1 by dropping unknown-key checking altogether.
3. **Rejects a missing `profileId`.**

**Tests — fetch bridge** (`tests/unit/job-search-fetch-bridge.test.ts`)

1. **Decodes the host's base64 body and derives `ok` from the status.** Fails against a bridge that
   passes `bodyBase64` through as text.
2. **Reports a 429 as not-ok rather than throwing.** The adapters branch on `ok` to build a
   structured cause; a throwing bridge loses the partial results the adapter already collected.
3. **Passes request headers through in the host's own shape** — one object argument
   `{url, method, headers}`, not `(url, init)`. This is the whole reason the bridge exists, and a
   two-argument call would reach `ctx.fetch` as an ignored second parameter.

**Tests — store against a real database** (`tests/integration/job-search-store.test.ts`)

This runs **before** any handler depends on the store; everything above is invisible to a fake.
All of it through `createAppRuntimeRunner().withDataContext({actorUserId})` — the migration-owner
role is `NOBYPASSRLS`, so a raw query against these FORCE-RLS tables returns zero rows and every
assertion below passes for the wrong reason.

1. **`listProfiles` is stable across calls** with profiles created inside the same millisecond. This
   is what the `id ASC` tiebreak is for; without it the test is flaky rather than failing.
2. **`upsertPostings` twice with the same natural key** yields one row, updated fields, and an
   **unchanged `first_seen_at`**. Fails against an upsert that touches `first_seen_at`, which would
   silently erase what "new since" means.
3. **`setEmbedding` then `listUnscoredPostingsWithEmbeddings`** round-trips a 768-vector and
   `vector_dims` reports 768 — the cast working end to end.
4. **A posting with a match row is excluded** from `listUnscoredPostingsWithEmbeddings`, and one
   without it is included. Fails against a state-column check instead of `NOT EXISTS`.
5. **Concurrent `setResume`** — fire two on **two separate connections** without awaiting the first;
   assert versions 1 and 2 **and no error surfaced**. Two rules make this a real test: same-connection
   calls serialize for free and prove nothing, and sequential calls pass against the racy
   read-then-insert. A `FOR UPDATE`-only implementation fails this case. Then a third sub-case:
   `setResume` against a nonexistent profile id throws **immediately**, not after five attempts, and
   the message says "no such profile" rather than anything about contention.
6. **`setPortalState` with a failure cause preserves `last_ok_at`** from the previous success. Fails
   against an upsert without the `COALESCE`.
7. **`getSweepCursor` on a fresh install returns 0**, and survives a `setSweepCursor` followed by a
   profile delete. Then inspect the **stored KV payload directly** and assert it is `{ index: 3 }` —
   an object, not a bare `3`. Catches a store that typechecks against a `Promise<number>` façade
   while writing a shape the KV port cannot hold.
8. **A corrupt cursor reads as 0, not as NaN.** Write `{ index: "seven" }` into the KV key and assert
   `getSweepCursor()` returns `0`. Without read-side validation this returns `NaN`, `rotate()`
   produces an empty list, and the sweep does nothing forever without an error.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-validate.test.ts tests/unit/job-search-fetch-bridge.test.ts \
  && pnpm test:integration tests/integration/job-search-store.test.ts \
  && pnpm check:external-modules
```

Exit 0 for all three. The store test needs the module installed, so run it after Task 4's migrations
have been applied to the test database.
