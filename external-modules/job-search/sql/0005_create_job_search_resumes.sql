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
