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
