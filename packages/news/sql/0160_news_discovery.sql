-- #958 (epic #954) News Slice 2 — owner-scoped refresh coordination and policy cache.
-- RLS classification: owner-only, including worker access. Worker grants on Slice 1 tables are
-- limited to the reads and health/snapshot writes required to compile one actor's feed.

CREATE TABLE IF NOT EXISTS app.news_refresh_state (
  owner_user_id         uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  state                 text NOT NULL CHECK (state IN ('idle', 'queued', 'running', 'failed')),
  failure_kind          text CHECK (failure_kind IN ('fetch', 'ai', 'internal')),
  requested_generation  bigint NOT NULL DEFAULT 0,
  compiled_generation   bigint NOT NULL DEFAULT 0,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.news_policy_verdicts (
  owner_user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  canonical_domain text NOT NULL
    CHECK (canonical_domain = lower(canonical_domain) AND length(canonical_domain) <= 253),
  fingerprint      text NOT NULL,
  verdict          text NOT NULL CHECK (verdict IN ('approved', 'rejected')),
  decided_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id, canonical_domain)
);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['news_refresh_state', 'news_policy_verdicts']
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I', tbl || '_select', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
         USING (owner_user_id = app.current_actor_user_id())',
      tbl || '_select', tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I', tbl || '_insert', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR INSERT TO jarvis_app_runtime, jarvis_worker_runtime
         WITH CHECK (owner_user_id = app.current_actor_user_id())',
      tbl || '_insert', tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I', tbl || '_update', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR UPDATE TO jarvis_app_runtime, jarvis_worker_runtime
         USING (owner_user_id = app.current_actor_user_id())
         WITH CHECK (owner_user_id = app.current_actor_user_id())',
      tbl || '_update', tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I', tbl || '_delete', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR DELETE TO jarvis_app_runtime, jarvis_worker_runtime
         USING (owner_user_id = app.current_actor_user_id())',
      tbl || '_delete', tbl
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO jarvis_app_runtime, jarvis_worker_runtime',
      tbl
    );
  END LOOP;
END
$$;

-- Compilation worker reads only the active actor's source identity and may update health only.
GRANT SELECT ON app.news_custom_sources TO jarvis_worker_runtime;
GRANT UPDATE (health_status) ON app.news_custom_sources TO jarvis_worker_runtime;
DROP POLICY IF EXISTS news_custom_sources_worker_select ON app.news_custom_sources;
CREATE POLICY news_custom_sources_worker_select ON app.news_custom_sources
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());
DROP POLICY IF EXISTS news_custom_sources_worker_update ON app.news_custom_sources;
CREATE POLICY news_custom_sources_worker_update ON app.news_custom_sources
  FOR UPDATE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

-- Compilation worker reads the active actor's topic and exclusion inputs.
GRANT SELECT ON app.news_custom_topics, app.news_source_exclusions TO jarvis_worker_runtime;
DROP POLICY IF EXISTS news_custom_topics_worker_select ON app.news_custom_topics;
CREATE POLICY news_custom_topics_worker_select ON app.news_custom_topics
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());
DROP POLICY IF EXISTS news_source_exclusions_worker_select ON app.news_source_exclusions;
CREATE POLICY news_source_exclusions_worker_select ON app.news_source_exclusions
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

-- Compilation worker atomically replaces and prunes only the active actor's derived snapshot.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.news_compilation_snapshots TO jarvis_worker_runtime;
DROP POLICY IF EXISTS news_compilation_snapshots_worker_select ON app.news_compilation_snapshots;
CREATE POLICY news_compilation_snapshots_worker_select ON app.news_compilation_snapshots
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());
DROP POLICY IF EXISTS news_compilation_snapshots_worker_insert ON app.news_compilation_snapshots;
CREATE POLICY news_compilation_snapshots_worker_insert ON app.news_compilation_snapshots
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());
DROP POLICY IF EXISTS news_compilation_snapshots_worker_update ON app.news_compilation_snapshots;
CREATE POLICY news_compilation_snapshots_worker_update ON app.news_compilation_snapshots
  FOR UPDATE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());
DROP POLICY IF EXISTS news_compilation_snapshots_worker_delete ON app.news_compilation_snapshots;
CREATE POLICY news_compilation_snapshots_worker_delete ON app.news_compilation_snapshots
  FOR DELETE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

-- Curated source selection is an owner-scoped compilation input from migration 0151.
GRANT SELECT ON app.news_prefs TO jarvis_worker_runtime;
DROP POLICY IF EXISTS news_prefs_worker_select ON app.news_prefs;
CREATE POLICY news_prefs_worker_select ON app.news_prefs
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());
