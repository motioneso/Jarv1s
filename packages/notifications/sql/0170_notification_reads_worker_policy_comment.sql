-- #1077 follow-up: 0166 recreated notification_reads_select via DROP POLICY/CREATE POLICY,
-- which silently drops any COMMENT ON POLICY attached to the prior object (0166 must never
-- be edited post-apply, so the comment is restated here instead of folded back into it).
-- Re-state the 0102 defense-in-depth comment verbatim.
COMMENT ON POLICY notification_reads_select ON app.notification_reads IS
  'Exists-with-visible-parent guard: user_id owns the row AND the parent notification is '
  'currently visible to the actor (both jarvis_app_runtime and jarvis_worker_runtime, '
  'SELECT only). The parent check is defense-in-depth, not redundant.';
