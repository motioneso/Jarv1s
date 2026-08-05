-- One actor-scoped continuation row. `pending` maps profile ids to the exact criteria snapshot
-- that still needs scoring. The lease serializes the manual criteria-save pass and scheduled
-- continuations even if more than one worker process is alive.
CREATE TABLE app.job_search_rescore_state (
  owner_user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  pending       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pending) = 'object'),
  lease_token   text,
  lease_until   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
