-- #975 (epic #954) News Slice 4 — provider-change revalidation worker grants.
-- RLS classification: owner-only, including worker access. The revalidation worker re-runs
-- source/topic policy checks when the owner's configured AI provider/model changes, so it must
-- persist validation outcomes. Least-privilege by coordinator directive: UPDATE is granted on
-- ONLY the four columns the worker writes, never table-wide, and every write stays owner-scoped
-- through RLS (the worker re-enters DataContext, setting app.current_actor_user_id from the
-- job's actorUserId). Worker role remains RLS-bound: no BYPASSRLS, not a superuser.
--
-- Column justification (identical for both tables):
--   validation_status      — the revalidation verdict (approved / needs_revalidation / rejected)
--                            that Settings/Today/News surface as actionable status.
--   validation_fingerprint — provider/model fingerprint the verdict was computed under; the
--                            idempotency key that lets reruns skip already-validated rows.
--   validated_at           — when the verdict was produced (drives staleness display).
--   updated_at             — row-modified bookkeeping; no trigger exists, repo methods set it.

GRANT UPDATE (validation_status, validation_fingerprint, validated_at, updated_at)
  ON app.news_custom_sources TO jarvis_worker_runtime;

-- Topics were SELECT-only for the worker in 0160; revalidation now writes them too, so topics
-- additionally need an owner-scoped worker UPDATE policy (sources already got theirs in 0160).
GRANT UPDATE (validation_status, validation_fingerprint, validated_at, updated_at)
  ON app.news_custom_topics TO jarvis_worker_runtime;
DROP POLICY IF EXISTS news_custom_topics_worker_update ON app.news_custom_topics;
CREATE POLICY news_custom_topics_worker_update ON app.news_custom_topics
  FOR UPDATE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());
