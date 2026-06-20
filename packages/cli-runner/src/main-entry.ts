/**
 * cli-runner BOOT ENTRY (#342). The single side-effecting module of the cli-runner
 * package: it imports {@link main} and runs it. The container entrypoint
 * (`infra/cli-runner-entrypoint.sh`) execs this via tsx.
 *
 * CRITICAL: nothing must ever `import` this file. The boot invocation lives here —
 * NOT in `main.ts` — precisely so that bundling `main.ts` into the api
 * (`dist/server.js`, which re-exports the cli-runner barrel) carries NO module-level
 * side effect. The old `if (isEntrypoint) main()` guard in `main.ts` used
 * `import.meta.url`, which esbuild COLLAPSES to the bundle URL, mis-firing the guard
 * in the api and booting a second CliRunnerServer. See `main.ts` for the full note.
 */

import { main } from "./main.js";

main().catch((err: unknown) => {
  console.error("[cli-runner] fatal:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
