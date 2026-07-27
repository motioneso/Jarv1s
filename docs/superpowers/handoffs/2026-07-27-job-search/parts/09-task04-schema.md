### Task 4: Database schema

The five owned tables, their owner-bound foreign keys, and the two read indexes. DDL is carried
verbatim below because a module migration is hash-checked and can never be edited once it applies —
the SQL is a decision, not an implementation.

**Depends on:** Task 3 (the manifest declares `database.ownedTables`, and `JOB_SEARCH_TABLES` already
exists). Tasks 13, 15, 18 and 21 all read these tables.

**Files**

- Create: `external-modules/job-search/sql/0001_create_job_search_profiles.sql`
- Create: `external-modules/job-search/sql/0002_create_job_search_portals.sql`
- Create: `external-modules/job-search/sql/0003_create_job_search_postings.sql`
- Create: `external-modules/job-search/sql/0004_create_job_search_matches.sql`
- Create: `external-modules/job-search/sql/0005_create_job_search_resumes.sql`
- Create: `external-modules/job-search/sql/0006_index_job_search_matches_board.sql`
- Create: `external-modules/job-search/sql/0007_index_job_search_postings_profile.sql`
- Test: `tests/integration/job-search-tables-install.test.ts`

**Contracts**

`0001_create_job_search_profiles.sql`:

```sql
-- One search profile per role the user is pursuing. `criteria` is the extracted,
-- user-confirmable frame (Task 10) — never free model prose.
-- owner_user_id is the mandatory RLS scoping column; the platform generates the
-- FORCE RLS policy from manifest.database.ownedTables at install time.
CREATE TABLE app.job_search_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  state         text NOT NULL CHECK (state IN ('in_conversation', 'active', 'paused')),
  criteria      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Broader-context summary distilled from the full-capability conversation (Task 8).
  -- Bounded and refreshed on confirmation; never raw transcript.
  context_summary text,
  schedule      text,
  -- How much this profile contributes to the daily briefing (Task 16's
  -- job-search.profile.set-briefing-detail tool; the settings screen in Task 20 writes it).
  -- On the profile row rather than in module KV for two reasons: it exports and deletes with the
  -- rest of the profile (NFR-7), and a stale KV entry can never disagree with a deleted profile.
  -- The three values are the union Task 16 already defines — do not add a fourth or rename one.
  briefing_detail text NOT NULL DEFAULT 'count'
                  CHECK (briefing_detail IN ('count', 'top', 'full')),
  -- Chat surface KEY for this profile's thread (Task 2c) — not the wire surface. The shell hashes
  -- (moduleId, key) into the legal surface string via moduleChatSurface(); a raw uuid here would
  -- never pass CHAT_SURFACE_PATTERN on its own. Stable for the profile's life.
  surface_key   text NOT NULL DEFAULT gen_random_uuid()::text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Redundant against the primary key on purpose. Every child table below binds
  -- (owner_user_id, profile_id) to THIS key, so a child row can only ever reference a parent
  -- owned by the same user. Without it, a child's single-column FK to `id` would happily point
  -- at another user's profile, and the generated RLS policy would not notice: the emitted
  -- predicate is `owner_user_id = app.current_actor_user_id()` on the child's OWN column
  -- (`packages/db/src/module-rls-emitter.ts:46`). A foreign key is not an RLS boundary.
  UNIQUE (owner_user_id, id)
);
```

`0002_create_job_search_portals.sql`:

```sql
-- Per-profile portal health. `cause` is the structured failure record from Task 5 —
-- which portal, what kind, what was retrieved, when it last worked, what happens next.
-- A bare "failed" is a spec violation, so there is no boolean-only error column.
CREATE TABLE app.job_search_portals (
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  source_id     text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  last_ok_at    timestamptz,
  cause         jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, profile_id, source_id),
  -- Owner-bound parent reference, not a bare `profile_id REFERENCES …(id)`. See the note on
  -- app.job_search_profiles: the single-column form lets a row owned by A hang off a profile
  -- owned by B, and RLS only ever checks this table's own owner_user_id.
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE
);
```

`0003_create_job_search_postings.sql`:

```sql
-- Postings are deduped across portals, so identity is (source_id, external_id).
-- The embedding is triage-only: it decides which postings a model reads, and its
-- similarity value is never surfaced to the user.
CREATE TABLE app.job_search_postings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  source_id     text NOT NULL,
  external_id   text NOT NULL,
  title         text NOT NULL,
  company       text NOT NULL,
  location      text NOT NULL,
  url           text NOT NULL,
  body          text NOT NULL,
  posted_at     timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  embedding     vector(768),
  UNIQUE (owner_user_id, profile_id, source_id, external_id),
  -- The key app.job_search_matches binds its posting reference to (same reasoning as profiles).
  UNIQUE (owner_user_id, id),
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE
);
```

`0004_create_job_search_matches.sql`:

```sql
-- Fit and Want are two independent axes and are stored as two independent columns.
-- There is deliberately NO blended/overall/total column: the schema is the last place
-- that rule can be enforced structurally, so it is enforced here.
-- outside_frame marks the reserved recall slice — postings deliberately surfaced from
-- outside the user's stated criteria (Task 8). It is a first-class flag, not a filter.
CREATE TABLE app.job_search_matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  posting_id    uuid NOT NULL,
  fit           integer CHECK (fit IS NULL OR fit BETWEEN 0 AND 100),
  want          integer CHECK (want IS NULL OR want BETWEEN 0 AND 100),
  fit_reason    text,
  want_reason   text,
  outside_frame boolean NOT NULL DEFAULT false,
  state         text NOT NULL CHECK (state IN ('unscored', 'new', 'seen', 'dismissed')),
  scored_at     timestamptz,
  UNIQUE (owner_user_id, profile_id, posting_id),
  -- BOTH parents are owner-bound. A match is the row that joins two other rows, so it is the
  -- one place where a single-column FK could stitch one user's posting to another user's
  -- profile and leave a legally-owned row behind that leaks a foreign posting through a join.
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id, posting_id)
    REFERENCES app.job_search_postings (owner_user_id, id) ON DELETE CASCADE
);
```

`0005_create_job_search_resumes.sql`:

```sql
-- One résumé per profile, versioned. The résumé is first-class input to Fit,
-- not an attachment bolted on afterwards.
CREATE TABLE app.job_search_resumes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  version       integer NOT NULL,
  content       text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, profile_id, version),
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE
);
```

`0006_index_job_search_matches_board.sql` — the board's primary read:

```sql
-- Board read: this profile's matches by state, newest scored first.
CREATE INDEX job_search_matches_board_idx
  ON app.job_search_matches (owner_user_id, profile_id, state, scored_at DESC);
```

`0007_index_job_search_postings_profile.sql` — the triage read:

```sql
-- Triage read: this profile's postings not yet matched, newest first.
CREATE INDEX job_search_postings_profile_idx
  ON app.job_search_postings (owner_user_id, profile_id, first_seen_at DESC);
```

**Constraints**

- **The RLS scoping column is always `owner_user_id`** — `packages/db/src/module-rls-emitter.ts`
  hardcodes `owner_user_id = app.current_actor_user_id()` (E1). A table named `user_id` installs and
  then every generated policy references a column that does not exist.
- **The module authors no RLS, no policy and no grant.** `installModule()` Phase B generates all of
  it from `manifest.database.ownedTables` (E2). Hand-written policies collide with the generated
  objects; this is not belt and braces.
- **One statement per file.** `packages/db/src/migrations/module-sql-runner.ts:41` allows exactly one
  statement whose first command is `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, `ALTER TABLE`,
  `DROP INDEX` or `COMMENT ON` (E3). Inline constraints inside a `CREATE TABLE` are one statement and
  are fine; a trailing `ALTER TABLE` in the same file is not.
- **A foreign key is not an RLS boundary.** The generated predicate checks each table's own
  `owner_user_id`, and FK checks run as the table owner without RLS filtering — so a child row
  carrying the *actor's* `owner_user_id` while pointing at *another user's* parent passes every
  policy. Every parent reference here is a composite `(owner_user_id, parent_id)` FK against a
  redundant `UNIQUE (owner_user_id, id)` on the parent, never a bare `parent_id REFERENCES …(id)`.
- **`JOB_SEARCH_TABLES` does not generate DDL.** Each migration must create the table whose bare name
  appears in that array; a table created under a different name satisfies Task 3's manifest test and
  fails at install.
- **Module SQL is applied by `installModule()`** and recorded in `app.module_schema_migrations`. It is
  **not** run by `pnpm db:migrate` and never appears in the core migration catalog, so
  `tests/integration/foundation.test.ts` needs no change — do not touch it.
- **`vector(768)` is safe.** `infra/postgres/bootstrap/0001_extensions.sql` installs pgvector as
  superuser before any migration runs, so the type exists for every role.
- **No ANN index on `embedding`.** The triage candidate set is one profile's recent postings; a
  sequential scan over it is cheaper than maintaining an index, and adding one later is a
  one-statement migration.
- **The test cannot connect as the runtime role — do not try.**
  `packages/db/src/module-role-broker.ts:63` creates every module role
  `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`, and only the *install* role is briefly flipped to
  LOGIN and forced back to `NOLOGIN PASSWORD NULL` on every call (:73). Assume the role inside a
  transaction instead — `BEGIN` → `SET LOCAL ROLE jarvis_mod_job_search_runtime` →
  `SELECT set_config('app.actor_user_id', $1, true)` — the shape
  `packages/db/src/module-storage-rpc.ts:89` uses in production, with the GUC set the way
  `packages/db/src/data-context.ts:64,90` sets it. Both die with the transaction, so tests cannot leak
  privilege into each other.
- **`seedUser` runs as bootstrap, outside the runtime role** — `app.users` is not a module-owned table
  and the runtime role has no grant on it.
- **Teardown order is REVOKE-before-DROP-CASCADE**, copied from
  `tests/integration/finance-tables-install.test.ts`. Phase B re-grants onward from the install role's
  `WITH GRANT OPTION`, so revoking without `CASCADE` leaves a dependent grant and blocks `DROP ROLE`.

**Tests**

`tests/integration/job-search-tables-install.test.ts` — proves the **real** `sql/` directory installs
through the real `installModule` pipeline. Mirror `tests/integration/finance-tables-install.test.ts`,
including its `afterEach`. Write the `seedUser` / `seedProfile` / `asRuntime` / `insertMatch` helpers
inline; leave no case as a comment.

1. **Every migration installs, with platform-generated FORCE RLS, idempotently.** Seven installed
   migrations; every `job_search_%` relation has `relforcerowsecurity`; seven rows in
   `app.module_schema_migrations`; a second `install()` reports zero. Catches a missing file, a table
   the platform did not recognise as owned, and a runner that reapplies.
2. **A 768-dimension posting embedding stores and reads back.** `vector_dims(embedding)` is 768.
   Seed the parent profile first — `profile_id` is `NOT NULL` with an owner-bound FK, so a bare insert
   dies on the FK rather than proving anything about the vector type.
3. **Another owner's profile is invisible.** Owner A inserts a profile; owner B selects and gets zero
   rows. The assertion is that B cannot see A's row *at all* — not merely that B has none of its own.
4. **An insert claiming another owner is refused** — B inserting with `owner_user_id = A` throws
   `row-level security`. The WITH CHECK half of the policy, which a read-only test never reaches.
5. **A child row pointing at another owner's parent is refused, on every child.** The case RLS cannot
   catch alone: B inserting a B-owned posting is legal as far as RLS is concerned, so the owner-bound
   composite FK has to notice the parent is A's. Cover postings, portals, résumés, and **both** of a
   match's two parents — B's posting under A's profile, *and* B's profile with A's posting. A schema
   binding only `profile_id` passes the first and fails the second, which is exactly why both are
   asserted.
6. **A fit score outside 0..100 is refused** — `fit: 101` throws `check constraint`.
7. **Briefing detail defaults to `count` and rejects a value outside the union.** The quiet default
   matters: a profile the user never opened settings for still contributes a one-line count to the
   briefing rather than vanishing from it. Then `UPDATE … SET briefing_detail = 'verbose'` throws.
   Use a **separate transaction** for the rejection — a constraint violation aborts the transaction it
   happens in, so a following assertion in the same block fails with
   `current transaction is aborted` instead of checking what it meant to. The column, not Task 16's
   tool, is the enforcement point: a tool can be bypassed by a later direct write and a column cannot.

**Verify**

```bash
pnpm test:integration tests/integration/job-search-tables-install.test.ts   # exit 0, seven cases
```

Do **not** run `pnpm db:migrate` — module SQL is not in that catalog.

---
