-- Migration 0150 — Voice (STT) settings: dedicated admin section (task #874, epic #869).
-- Renumbered 0149→0150: chat's 0149_chat_skills (#889) landed on main first; migrations
-- are global by landing order, so this AI migration takes the next free slot (0150).
--
-- WHY: Voice/transcription is configured as ONE generic OpenAI-compatible STT
-- endpoint that is kept conceptually separate from the chat-LLM provider list,
-- yet reuses app.ai_provider_configs + app.ai_configured_models so the
-- credential-encryption (AiSecretCipher) and direct-HTTP execution paths are
-- untouched. We need a discriminator so the two surfaces never bleed into each
-- other: the LLM Providers list and the Voice section must render DISJOINT sets,
-- and chat resolution / instance-default / per-user pin must never pick a
-- voice-only endpoint (and vice-versa). `purpose` is that discriminator.
--
-- The column default backfills every existing row to 'assistant' — a pure DDL
-- default reading no rows, so it is safe under FORCE RLS + the NOBYPASSRLS
-- migration role (same C1 precedent as 0147). No data statement runs here.
--
-- HIGH-5 (load-bearing): at most ONE voice endpoint may exist instance-wide. A
-- partial UNIQUE index over the constant expression `(true)` filtered to
-- `purpose = 'voice'` enforces "at most one voice row across the whole table" at
-- the database level (mirrors 0147's one-default index). This prevents two
-- admins — or a retried POST — from creating rival voice rows whose precedence
-- would then be an unspecified ORDER BY. The voice PUT is an upsert
-- (blind-update-else-insert) so it never trips this index.
--
-- No RLS/policy/trigger changes: migration 0091 already grants admins
-- INSERT/UPDATE on app.ai_provider_configs via current_actor_is_admin(), which
-- covers this new column, and the updated_at trigger's column OF-list does not
-- gate it.

ALTER TABLE app.ai_provider_configs
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'assistant'
  CHECK (purpose IN ('assistant', 'voice'));

-- HIGH-5 backstop: at most one voice(STT) endpoint, enforced globally.
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_configs_one_voice
  ON app.ai_provider_configs ((true))
  WHERE purpose = 'voice';
