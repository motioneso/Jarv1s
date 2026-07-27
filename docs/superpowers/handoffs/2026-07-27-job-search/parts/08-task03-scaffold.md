## Phase 1 — Module scaffold

### Task 3: Scaffold `external-modules/job-search`

The manifest every later task registers into, plus the owned-table list in a form TypeScript can
import.

**Depends on:** Task 2d (the nav `badge` field must validate) and Task 2 (the `briefing` block).
Everything in Phases 2–6 depends on this.

**Files**

- Create: `external-modules/job-search/package.json`, `tsconfig.json`, `jarvis.module.json`,
  `src/module-info.ts`, `src/db/tables.ts`
- Modify: root `package.json` — `check:external-modules` currently reads
  `tsc -p external-modules/finance --noEmit` and typechecks finance **only**
- Test: `tests/unit/job-search-manifest.test.ts`

**Contracts**

```ts
// external-modules/job-search/src/module-info.ts
/** The scaffold needs at least one file under src/: the shared tsconfig has
 * `"include": ["src"]`, and tsc exits non-zero with TS18003 ("No inputs were found")
 * on an empty include — so an empty scaffold would break `pnpm typecheck`. */
export const MODULE_ID = "job-search";
```

```ts
// external-modules/job-search/src/db/tables.ts
/** The owned-table list, in TypeScript, for everything that can import TypeScript: Task 4's
 * install test, Task 13's store, Task 21's RLS loop. A list retyped in a test is a list that
 * drifts, and an RLS test naming a table the migration never creates passes by finding nothing
 * wrong with nothing.
 *
 * It is NOT the source of truth for the manifest, and no comment here should claim it is.
 * `jarvis.module.json` is JSON — it cannot import a constant, and the shipped finance manifest
 * likewise carries a literal array (`external-modules/finance/jarvis.module.json:42`). The
 * literal in the manifest and this array are two independent copies; the equality assertion in
 * this task's manifest test is the ONLY thing that stops them drifting, which is why that test
 * lives here, with the manifest, rather than in the task that first consumes the constant. */
export const JOB_SEARCH_TABLES = [
  "job_search_profiles",
  "job_search_portals",
  "job_search_postings",
  "job_search_matches",
  "job_search_resumes"
] as const;
```

```json
// external-modules/job-search/package.json
{
  "name": "job-search",
  "private": true,
  "version": "0.1.0",
  "description": "Jarvis Job Search downloaded module. Prebuilt artifact package: jarvis.module.json + dist/worker.js + dist/web/index.js."
}
```

```json
// external-modules/job-search/jarvis.module.json
{
  "schemaVersion": 1,
  "id": "job-search",
  "name": "Job Search",
  "version": "0.1.0",
  "publisher": "Jarvis Project",
  "lifecycle": "optional",
  "compatibility": { "jarv1s": ">=0.1.0" },
  "description": "Finds job postings on public boards and reads each one against what you can do and what you actually want.",
  "auth": [],
  "storage": [
    { "namespace": "job-search.settings", "scopes": ["user"] },
    { "namespace": "job-search.meta", "scopes": ["user"] }
  ],
  "database": {
    "ownedTables": [
      "app.job_search_profiles",
      "app.job_search_portals",
      "app.job_search_postings",
      "app.job_search_matches",
      "app.job_search_resumes"
    ]
  },
  "runtime": { "workerEntrypoint": "dist/worker.js", "workerContractVersion": 1 },
  "fetchHosts": ["www.linkedin.com", "freehire.me"],
  "assistantTools": [],
  "worker": { "queues": [], "schedules": [], "reconcileJobs": [] },
  "briefing": {
    "handler": "briefing.contribute",
    "sections": ["morning", "evening"],
    "toolName": "job-search.briefing"
  },
  "web": { "entrypoint": "dist/web/index.js", "contractVersion": 1 },
  "navigation": [
    {
      "id": "job-search",
      "label": "Job Search",
      "path": "/",
      "icon": "compass",
      "badge": { "source": "notifications" }
    }
  ]
}
```

Root `package.json`:

```json
"check:external-modules": "tsc -p external-modules/finance --noEmit && tsc -p external-modules/job-search --noEmit"
```

**Constraints**

- **`external-modules/job-search/tsconfig.json` is `external-modules/finance/tsconfig.json` verbatim.**
  It already carries `jsx: "react"`, `jsxFactory: "h"`, and the `@jarv1s/module-sdk/worker` path
  alias. Do not diverge from it. Note the JSX factory consequence: every keyed component this module
  ships needs an explicit `key?: string` prop (I7).
- **`src/module-info.ts` exists so `tsc -p` has an input.** `"include": ["src"]` with no `src/` fails
  with TS18003 (K10).
- **`auth` is empty on purpose** — v1 uses no portal credentials, because it never signs in anywhere.
  Two declared fetch hosts only; Indeed is cut from v1 (L1) and user-nominated portals are deferred.
- **`assistantTools`, `queues` and `schedules` stay empty here** and fill in during Phases 4 and 5.
  The manifest test tolerates that because the badge and briefing assertions do not depend on them.
- **Queue `paramsSchema` is not JSON Schema.** When Task 13 adds queues, use the platform's own DSL —
  `{"type":"object","fields":{"profileId":{"type":"identifier"}}}` — the shape
  `isValidModuleParamsSchema` accepts (F8; see the `finance.categorize-apply` queue for a worked
  example). `assistantTools[].inputSchema` **is** JSON Schema. Two different languages in one file.
- **`icon: "compass"` is a Lucide icon name, not the retired product name.** Verify it in two steps —
  the grep is a locator, not a verification. `rg "landmark" apps/web/src --files-with-matches` only
  tells you which file holds the nav icon map. Open that file and check how icons resolve: an
  explicit map means `compass` must be **added to the map** or the nav renders nothing; a wholesale
  `lucide-react` re-export means confirm the export exists
  (`rg "^export .*\bCompass\b" node_modules/lucide-react/dist/lucide-react.d.ts`). Fall back to
  `briefcase` only if neither route works. A silently missing icon is the failure mode.
- **`pnpm typecheck` is the only gate that covers external modules** — nothing else compiles them,
  so extending `check:external-modules` is part of this task, not a follow-up.

**Tests**

`tests/unit/job-search-manifest.test.ts` — assert **through `validateExternalModuleManifest`**, never
against the raw JSON. The validator reconstructs from an explicit field allowlist and silently
discards what it does not know (F1), so a test reading the JSON file directly passes for a manifest
the loader would strip to pieces.

1. **The manifest validates against the real loader.**
2. **It declares only hosts that serve public postings** — `fetchHosts` equals
   `["www.linkedin.com", "freehire.me"]`. A third host appearing here is a scope change, not a typo.
3. **It owns exactly the tables `JOB_SEARCH_TABLES` names, in the same order** —
   `database.ownedTables` deep-equals `JOB_SEARCH_TABLES.map(t => "app." + t)`. THE seam: the JSON
   literal and the TS constant are two copies of one list and nothing in the toolchain relates them
   (F2). A table added to one and forgotten in the other produces a module that installs happily and
   then has an unprotected or a non-existent table. Deliberately exact deep equality including order,
   not a set comparison.
4. **It names five tables.** Pinned separately so that "fixing" case 3 by editing both lists at once
   still fails and forces the spec conversation.
5. **It survives reconstruction with its briefing block and nav badge intact** — `briefing` equals
   `{handler: "briefing.contribute", sections: ["morning","evening"], toolName: "job-search.briefing"}`
   and `navigation[0].badge` equals `{source: "notifications"}`. Both fields are new to the validator
   (Tasks 2 and 2d); this is the assertion that catches a validator that accepts but does not re-emit.
6. **The briefing handler stays out of the chat tool registry.** A briefing handler is a **worker**
   handler, which is what keeps it invisible to chat. The validator never enumerates handlers, so
   assert the negative directly: no `assistantTools` entry and no queue routes to
   `briefing.contribute`.
7. **No blended score is exposed through any tool schema** — the serialized validated manifest
   contains none of `overall`, `combinedScore`, `totalScore`, `matchScore` (L9). Cheap, and it fails
   the moment someone adds a convenience field in a later task.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-manifest.test.ts   # exit 0
pnpm check:external-modules                              # exit 0
```

---
