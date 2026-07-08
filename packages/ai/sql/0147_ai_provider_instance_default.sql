-- Migration 0147 — Assistant & AI admin Slice 1 (task #870, epic #869).
--
-- WHY: Slice 1 makes the Assistant & AI admin self-configuring. The admin now
-- picks ONE instance-default provider; user-facing services (Chat, Voice) that
-- are bound to a "mode" (tier) resolve their model *inside* that default
-- provider. This replaces the old per-capability free-for-all where every
-- capability could dangle on an arbitrary provider. We need a durable,
-- single-source-of-truth flag for "this is the instance-default provider".
--
-- H1 (load-bearing): the flag must be globally single-valued. A partial UNIQUE
-- index on the constant expression `(true)` filtered to rows WHERE
-- is_instance_default enforces "at most one default across the whole table" at
-- the database level — not per-owner, GLOBAL. The application still flips the
-- flag inside one transaction (clear-all-then-set-one) so the write never
-- transiently violates the constraint; the index is the backstop that makes a
-- second default physically impossible even under a racing writer.
--
-- C1 (load-bearing): this migration is DDL ONLY. app.ai_provider_configs is
-- FORCE RLS and the migration role is NOBYPASSRLS, so any data-touching
-- statement here would see zero rows. Choosing/seeding the initial default is
-- done lazily in application code (AiRepository), never in SQL.
--
-- No RLS/policy/trigger changes: migration 0091 already grants admins UPDATE on
-- app.ai_provider_configs via current_actor_is_admin(), which covers this new
-- column, and the updated_at trigger's column OF-list does not gate this flag.

ALTER TABLE app.ai_provider_configs
  ADD COLUMN IF NOT EXISTS is_instance_default boolean NOT NULL DEFAULT false;

-- H1 backstop: at most one instance-default provider, enforced globally.
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_configs_one_default
  ON app.ai_provider_configs ((true))
  WHERE is_instance_default;
