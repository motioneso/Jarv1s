// The owned-table list, in TypeScript, for everything that can import TypeScript: Task 4's
// install test, Task 13's store, Task 21's RLS loop. A list retyped in a test is a list that
// drifts, and an RLS test naming a table the migration never creates passes by finding nothing
// wrong with nothing.
//
// It is NOT the source of truth for the manifest, and no comment here should claim it is.
// `jarvis.module.json` is JSON — it cannot import a constant, and the shipped finance manifest
// likewise carries a literal owned-table array (`external-modules/finance/jarvis.module.json`).
// The literal in the manifest and this array are two independent copies; the equality assertion
// in tests/unit/job-search-manifest.test.ts is the ONLY thing that stops them drifting.
export const JOB_SEARCH_TABLES = [
  "job_search_profiles",
  "job_search_portals",
  "job_search_postings",
  "job_search_matches",
  "job_search_resumes"
] as const;
