-- Task 24 (#1309): a user-named job board, registered conversationally. This is the DEFINITION
-- only (ledger N17, storage mechanism revised by N18): host/label/url are what turns it into an
-- ordinary Portal at crawl time -- a custom source is not a second code path, it is one more row
-- listPortals can join against. It is NOT the fetch capability. `host` being fetchable for this
-- owner is a separate fact, recorded as a row in the existing platform-owned app.module_kv table
-- (no new table here) -- module isolation cuts both directions: a module never queries another
-- module's tables, and the platform never reaches into a module's own tables either, so
-- worker-rpc-host.ts's fetch.request branch cannot query this table directly.
CREATE TABLE app.job_search_custom_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  -- Lowercase, no port, no IP literal -- the exact shape isPinnableHost already requires
  -- (packages/host-fetch/src/policy.ts:1). Re-validated at the RPC boundary on every fetch
  -- regardless of what's stored here; this column is not the only place the invariant is checked.
  host          text NOT NULL,
  label         text NOT NULL,
  -- The page the adapter fetches. Always https (enforced at registration AND, independently, by
  -- createHostPinnedFetch itself, which rejects a non-https URL at request time).
  url           text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Composite FK safety (see app.job_search_profiles's own comment): a single-column
  -- `profile_id REFERENCES … (id)` would let a row owned by A hang off a profile owned by B.
  UNIQUE (owner_user_id, id),
  UNIQUE (owner_user_id, profile_id, host),
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE
);
