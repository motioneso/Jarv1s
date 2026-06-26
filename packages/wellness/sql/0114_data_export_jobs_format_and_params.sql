-- Wellness selective export (#484): carry format + window params on data_export_jobs.
-- One table continues to serve both the JSON full-archive pipeline (settings) and the
-- Wellness selective HTML export (wellness). format defaults to 'json' so existing rows
-- and the JSON pipeline are untouched; the Wellness pipeline writes 'html' and stashes
-- the selected timeframe + category names in params (filter descriptors only — NEVER
-- health content, per the CLAUDE.md metadata-only invariant).
ALTER TABLE app.data_export_jobs
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'json'
    CHECK (format IN ('json', 'html')),
  ADD COLUMN IF NOT EXISTS params jsonb;
