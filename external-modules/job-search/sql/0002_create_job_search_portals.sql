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
