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
