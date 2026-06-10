ALTER TABLE app.ai_configured_models
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'interactive'
  CHECK (tier IN ('reasoning', 'interactive', 'economy'));
