-- Existing Fit values predate the structured disposition that prevents a strong band from
-- contradicting negative evidence. Clearing only Fit feeds those rows into the existing
-- bounded `unfitted` repair pass; Want, reasons, state, and posting data remain untouched.
UPDATE app.job_search_matches
SET fit = NULL
WHERE fit IS NOT NULL;
