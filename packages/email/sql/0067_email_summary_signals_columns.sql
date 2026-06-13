-- Phase 3 connector-sync: add LLM-derived email triage columns.
-- summary: a concise natural-language summary string (nullable; null when the LLM
--   pass is skipped or fails). signals: a typed JSON object of extracted triage
--   signals (bills due, action items, deadlines, may-get-lost flag, importance,
--   confidence). The full email body is NEVER a column (privacy posture, spec §6).
-- Additive only; the existing snippet/body_excerpt columns are unchanged.

ALTER TABLE app.email_messages ADD COLUMN IF NOT EXISTS summary text;

ALTER TABLE app.email_messages
  ADD COLUMN IF NOT EXISTS signals jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(signals) = 'object');
