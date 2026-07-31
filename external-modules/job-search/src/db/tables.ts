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
  "job_search_resumes",
  "job_search_custom_sources"
] as const;

// Task 24 (#1309): `source.add`'s "already a built-in source" rejection needs the module's own
// static fetchHosts to check against, and `jarvis.module.json` is JSON for the same reason
// JOB_SEARCH_TABLES exists above — it cannot import this constant. Same two-independent-copies
// shape as JOB_SEARCH_TABLES: `tests/unit/job-search-manifest.test.ts`'s "declares only hosts
// that serve public postings" case is what stops this array and the manifest's `fetchHosts`
// literal from drifting apart.
export const JOB_SEARCH_STATIC_FETCH_HOSTS = ["www.linkedin.com", "freehire.me"] as const;
