-- Board read: this profile's matches by state, newest scored first.
CREATE INDEX job_search_matches_board_idx
  ON app.job_search_matches (owner_user_id, profile_id, state, scored_at DESC);
