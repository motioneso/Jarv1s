-- 0009 was recorded after running under the module installer role, but existing module tables
-- had FORCE RLS and no installer policy, so its UPDATE matched no rows. The platform installer
-- now relaxes FORCE RLS transactionally while applying migrations; retry without editing 0009.
UPDATE app.job_search_matches
SET fit = NULL
WHERE fit IS NOT NULL;
