// The scaffold needs at least one file under src/: the shared tsconfig has
// "include": ["src"], and tsc exits non-zero with TS18003 ("No inputs were found")
// on an empty include — so an empty scaffold would break `pnpm typecheck` (K10).
export const MODULE_ID = "job-search";
