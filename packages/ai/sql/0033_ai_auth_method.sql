-- Migration: add auth_method column to ai_provider_configs
-- Supports 'api_key' (default, existing behaviour) and 'cli' (no credential required).
ALTER TABLE app.ai_provider_configs
  ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'api_key'
    CHECK (auth_method IN ('cli', 'api_key'));
