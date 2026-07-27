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
