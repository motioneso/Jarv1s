DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = 'app.briefing_type'::regtype
      AND enumlabel = 'weekly_review'
  ) THEN
    ALTER TYPE app.briefing_type ADD VALUE 'weekly_review';
  END IF;
END
$$;
