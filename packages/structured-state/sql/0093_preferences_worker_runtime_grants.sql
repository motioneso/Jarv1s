-- Source-behavior policy (#247): briefings workers consult per-user preferences to
-- decide which sources may appear in a generated briefing. app.preferences was
-- created in 0031 for app_runtime only, so the worker needs SELECT plus the same
-- owner-scoped RLS policy. SELECT only: workers must not mutate user preferences.

GRANT SELECT ON app.preferences TO jarvis_worker_runtime;

DROP POLICY IF EXISTS preferences_select ON app.preferences;
CREATE POLICY preferences_select ON app.preferences
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());
