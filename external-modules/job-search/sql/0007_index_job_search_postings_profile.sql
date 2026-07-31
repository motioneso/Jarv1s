-- Triage read: this profile's postings not yet matched, newest first.
CREATE INDEX job_search_postings_profile_idx
  ON app.job_search_postings (owner_user_id, profile_id, first_seen_at DESC);
