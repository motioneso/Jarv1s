ALTER TABLE app.notifications
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'normal'
    CONSTRAINT notifications_urgency_check CHECK (urgency IN ('urgent', 'normal', 'low'));

ALTER TABLE app.notifications
  ADD COLUMN IF NOT EXISTS deferred_until timestamptz;

CREATE INDEX IF NOT EXISTS notifications_deferred_until_idx
  ON app.notifications (deferred_until)
  WHERE deferred_until IS NOT NULL;
