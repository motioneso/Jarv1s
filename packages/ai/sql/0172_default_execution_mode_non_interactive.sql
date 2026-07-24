-- Epic #1238 / task #1239 — default the chat engine to the one-shot ("-p"/"exec")
-- execution mode for every provider. The interactive long-running CLI session is the
-- fragile part (it cannot hold a multi-step tool sequence across an async, human-gated
-- approval — it stalled live in job-search JS-02 UAT), so one-shot becomes the default.
--
-- The one-shot engines already exist and are wired (ClaudePrintChatEngine /
-- AgyPrintChatEngine / CodexExecSession); this migration only flips the resolved
-- default. The interactive route stays selectable per provider as a fallback — the
-- CHECK constraint keeps both values valid and the column stays settable.
--
-- 0117 is applied and hash-checked; never edit it. This is a new, additive migration.

ALTER TABLE app.ai_provider_configs
  ALTER COLUMN execution_mode SET DEFAULT 'non_interactive';

-- Backfill existing rows. Until now 'interactive' was the sole default, so every stored
-- 'interactive' value is an unchosen default rather than a deliberate choice — moving them
-- to one-shot matches intent. A user re-selects interactive per provider afterward if they
-- want the fallback. (Release summary notes this.)
UPDATE app.ai_provider_configs
  SET execution_mode = 'non_interactive'
  WHERE execution_mode = 'interactive';
