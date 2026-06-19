ALTER TABLE app.connector_accounts
  ADD COLUMN IF NOT EXISTS last_sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_status text,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS last_sync_counts jsonb;

ALTER TABLE app.connector_accounts
  DROP CONSTRAINT IF EXISTS connector_accounts_last_sync_status_check,
  ADD CONSTRAINT connector_accounts_last_sync_status_check
    CHECK (last_sync_status IS NULL OR last_sync_status IN ('success', 'partial', 'failed')),
  DROP CONSTRAINT IF EXISTS connector_accounts_last_sync_counts_object_check,
  ADD CONSTRAINT connector_accounts_last_sync_counts_object_check
    CHECK (last_sync_counts IS NULL OR jsonb_typeof(last_sync_counts) = 'object');

GRANT UPDATE (
  last_sync_started_at,
  last_sync_finished_at,
  last_sync_status,
  last_sync_error,
  last_sync_counts,
  updated_at
) ON app.connector_accounts TO jarvis_worker_runtime;
