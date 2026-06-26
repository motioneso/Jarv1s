ALTER TABLE app.ai_provider_configs
  ADD COLUMN execution_mode text NOT NULL DEFAULT 'interactive';

ALTER TABLE app.ai_provider_configs
  ADD CONSTRAINT ai_provider_configs_execution_mode_check
  CHECK (execution_mode IN ('interactive', 'non_interactive'));
