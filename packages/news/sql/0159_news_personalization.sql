-- packages/news/sql/0159_news_personalization.sql
-- #953 (epic #954) News Slice 1 — personalization persistence boundary.
-- RLS classification: owner-only (FORCE — applies to every actor including admins) for all
-- four tables. NO worker-runtime grants in Slice 1; Slice 2 adds only the worker access it
-- proves it needs (spec docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md).
--
--   app.news_custom_sources        user-added publishers (Slice 2 writes after validation)
--   app.news_custom_topics         freeform topics + optional guidance (Slice 2 writes)
--   app.news_source_exclusions     canonical-domain blocklist (Slice 1 create/delete)
--   app.news_compilation_snapshots one derived, exportable-never snapshot row per user
--
-- canonical_domain columns store a lowercase ASCII hostname (punycode for IDN), already
-- normalized/validated by the News module's normalizePublisherDomain — the CHECKs here are
-- defense-in-depth bounds, not the parser.

CREATE TABLE IF NOT EXISTS app.news_custom_sources (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id            uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  label                    text NOT NULL
    CHECK (char_length(label) BETWEEN 1 AND 120),
  canonical_domain         text NOT NULL
    CHECK (char_length(canonical_domain) BETWEEN 1 AND 253
           AND canonical_domain = lower(canonical_domain)),
  homepage_url             text NOT NULL
    CHECK (char_length(homepage_url) <= 2048 AND homepage_url LIKE 'https://%'),
  feed_url                 text
    CHECK (feed_url IS NULL
           OR (char_length(feed_url) <= 2048 AND feed_url LIKE 'https://%')),
  retrieval_method         text NOT NULL CHECK (retrieval_method IN ('feed', 'scrape')),
  validation_status        text NOT NULL
    CHECK (validation_status IN ('approved', 'needs_revalidation', 'rejected')),
  health_status            text NOT NULL CHECK (health_status IN ('available', 'unavailable')),
  -- Opaque revalidation marker (e.g. hash of the validating configuration); deliberately NOT
  -- a foreign key into AI tables so no provider/model identity leaks into this module.
  validation_fingerprint   text NOT NULL CHECK (char_length(validation_fingerprint) <= 255),
  validated_at             timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, canonical_domain)
);

CREATE INDEX IF NOT EXISTS news_custom_sources_owner_idx
  ON app.news_custom_sources (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.news_custom_topics (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id            uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  label                    text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  guidance                 text CHECK (guidance IS NULL OR char_length(guidance) <= 1000),
  validation_status        text NOT NULL
    CHECK (validation_status IN ('approved', 'needs_revalidation', 'rejected')),
  validation_fingerprint   text NOT NULL CHECK (char_length(validation_fingerprint) <= 255),
  validated_at             timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive per-owner label uniqueness ("AI Safety" and "ai safety" are one topic).
CREATE UNIQUE INDEX IF NOT EXISTS news_custom_topics_owner_label_ci_uniq
  ON app.news_custom_topics (owner_user_id, lower(label));

CREATE INDEX IF NOT EXISTS news_custom_topics_owner_idx
  ON app.news_custom_topics (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.news_source_exclusions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  canonical_domain  text NOT NULL
    CHECK (char_length(canonical_domain) BETWEEN 1 AND 253
           AND canonical_domain = lower(canonical_domain)),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, canonical_domain)
);

CREATE INDEX IF NOT EXISTS news_source_exclusions_owner_idx
  ON app.news_source_exclusions (owner_user_id, created_at DESC);

-- Derived/transient compiled-feed cache: one row per user, replaced atomically, deleted with
-- the user, and NEVER included in account export. Payload shape is provisionally guarded by
-- the News-owned assertSnapshotPayload until Slice 2 fixes the compilation contract.
CREATE TABLE IF NOT EXISTS app.news_compilation_snapshots (
  owner_user_id  uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  compiled_at    timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Owner-only FORCE RLS + app-runtime-only grants, identical posture for all four tables.
-- (Plain DO block instead of a helper function to keep the migration self-contained.)
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'news_custom_sources',
    'news_custom_topics',
    'news_source_exclusions',
    'news_compilation_snapshots'
  ]
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I', tbl || '_select', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR SELECT TO jarvis_app_runtime
         USING (owner_user_id = app.current_actor_user_id())',
      tbl || '_select', tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I', tbl || '_insert', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR INSERT TO jarvis_app_runtime
         WITH CHECK (owner_user_id = app.current_actor_user_id())',
      tbl || '_insert', tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I', tbl || '_update', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR UPDATE TO jarvis_app_runtime
         USING (owner_user_id = app.current_actor_user_id())
         WITH CHECK (owner_user_id = app.current_actor_user_id())',
      tbl || '_update', tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I', tbl || '_delete', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR DELETE TO jarvis_app_runtime
         USING (owner_user_id = app.current_actor_user_id())',
      tbl || '_delete', tbl
    );

    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO jarvis_app_runtime', tbl
    );
    -- No jarvis_worker_runtime grants: Slice 1 has no worker path to this data.
  END LOOP;
END
$$;
