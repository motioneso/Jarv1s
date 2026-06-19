-- Notifications V1 — capture the recipient-only / defense-in-depth contract in SQL comments
-- so future maintainers cannot quietly "fix" the absent-vs-denied 404 behavior or drop the
-- notification_reads EXISTS guard. Comments only — no schema change, no RLS change.
-- New file — never edit 0008 / 0024 / 0029 / 0071.

COMMENT ON TABLE app.notifications IS
  'Notifications V1: in-app, actor-scoped delivery. recipient_user_id is always '
  'app.current_actor_user_id(); the app role (0008/0024/0029) and the worker role (0071) '
  'both enforce this on INSERT and SELECT. Not a cross-user/system broadcast mechanism. '
  'The PATCH /api/notifications/:id/read route returns 404 for BOTH absent and '
  'RLS-invisible ids — intentionally indistinguishable, do not "fix" this into an '
  'existence side-channel.';

COMMENT ON TABLE app.notification_reads IS
  'Per-actor read state. Every policy re-checks parent-notification visibility via an '
  'EXISTS subquery against app.notifications — defense-in-depth so this table cannot '
  'leak notification ids even if its own RLS is later weakened. Do not drop the EXISTS '
  'clause.';

COMMENT ON POLICY notification_reads_select ON app.notification_reads IS
  'Exists-with-visible-parent guard: user_id owns the row AND the parent notification is '
  'currently visible to the actor. The parent check is defense-in-depth, not redundant.';

COMMENT ON POLICY notification_reads_insert ON app.notification_reads IS
  'User may only record a read for themselves on a notification currently visible to them.';

COMMENT ON POLICY notification_reads_update ON app.notification_reads IS
  'Same visibility guard as select/insert; only read_at may change.';

COMMENT ON POLICY notifications_select ON app.notifications IS
  'Recipient-only: a notification is visible iff its recipient is the current actor.';

COMMENT ON POLICY notifications_insert ON app.notifications IS
  'Recipient-only: a notification may be created iff its recipient (and actor, when '
  'non-null) is the current actor. Worker role mirrors this in 0071.';
