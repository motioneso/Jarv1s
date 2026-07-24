-- Epic #1238 / task #1239 — re-run the execution_mode backfill that 0172 could not apply.
--
-- 0172 flipped the column DEFAULT to 'non_interactive' (DDL, not row-gated, so it took) and
-- also issued `UPDATE ... WHERE execution_mode = 'interactive'` to move existing rows. But
-- app.ai_provider_configs is FORCE ROW LEVEL SECURITY and the migration runner connects as
-- jarvis_migration_owner, which is NOBYPASSRLS — so that UPDATE matched 0 rows silently.
-- Grounding the flip on the real dev DB surfaced this: every pre-existing 'interactive' row
-- (including production users' auto-registered providers) stayed on the interactive engine,
-- which is exactly the stalling path 0172 was meant to retire.
--
-- Fix: temporarily drop RLS on the table for the length of this owner-run migration to perform
-- the one-time data backfill, then restore ENABLE + FORCE. This mirrors the established
-- backfill idiom in packages/memory/sql/0090_chat_memory_facts_provenance.sql. It is a
-- DDL-context, single-transaction toggle by the table owner — NOT a runtime BYPASSRLS grant,
-- so the "no admin private-data bypass" invariant is preserved (runtime app/worker roles are
-- untouched and RLS is FORCE again on commit).
--
-- 0172 is applied and hash-checked; never edit it. This is a new, additive migration.

ALTER TABLE app.ai_provider_configs DISABLE ROW LEVEL SECURITY;

-- Until 0172, 'interactive' was the sole default, so every stored 'interactive' value is an
-- unchosen default rather than a deliberate choice — moving them to one-shot matches intent.
-- A user re-selects interactive per provider afterward if they want the fallback.
UPDATE app.ai_provider_configs
  SET execution_mode = 'non_interactive'
  WHERE execution_mode = 'interactive';

ALTER TABLE app.ai_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_provider_configs FORCE ROW LEVEL SECURITY;
