-- Extend the shared suppression store into the corrections log surface (#244).
-- Keep owner-only RLS from 0092; add metadata needed to describe real corrections.

ALTER TABLE app.chat_memory_suppressions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'pattern-reject',
  ADD COLUMN IF NOT EXISTS fact_id UUID NULL REFERENCES app.chat_memory_facts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS before_content TEXT NULL,
  ADD COLUMN IF NOT EXISTS after_content TEXT NULL;

ALTER TABLE app.chat_memory_suppressions
  DROP CONSTRAINT IF EXISTS chat_memory_suppressions_reason_check;
ALTER TABLE app.chat_memory_suppressions
  ADD CONSTRAINT chat_memory_suppressions_reason_check
  CHECK (reason IN ('rejected', 'corrected'));

ALTER TABLE app.chat_memory_suppressions
  DROP CONSTRAINT IF EXISTS chat_memory_suppressions_source_check;
ALTER TABLE app.chat_memory_suppressions
  ADD CONSTRAINT chat_memory_suppressions_source_check
  CHECK (source IN ('chat', 'pattern-reject'));

CREATE INDEX IF NOT EXISTS chat_memory_suppressions_fact_idx
  ON app.chat_memory_suppressions (owner_user_id, fact_id, created_at DESC);
