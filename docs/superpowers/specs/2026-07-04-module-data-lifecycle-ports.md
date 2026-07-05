# Module data-lifecycle ports (manifest-declared export/deletion contributions)

**Status:** draft (2026-07-04) — design spec for task issue #801, part of epic #798 (module docking
seams). Flip #801 to `RFA` once approved.

**Grounded on:** `origin/main` @ `cc23e808` (audit verified at `2797fc1f`). Re-run
`pnpm audit:preflight` before building.

---

## Problem

Full-account export and account deletion are hand-maintained hubs that must be edited every time a
module adds a table:

- `packages/settings/src/data-export.ts:58-59,120-123,768-845` — hand-written queries against
  wellness-owned tables; the file reads ~40 tables spanning every module (calendar, chat,
  commitments, wellness, tasks, goals, memory, email, …) directly, bypassing module repositories.
- `packages/settings/src/data-export-jobs.ts:112-114` — maps module payload sections by hand.
- `packages/settings/src/data-export-async-routes.ts:127` — per-module filename branches.
- `scripts/delete-user-data.ts:84-87` — a hardcoded per-module table list for hard deletion.
- Sports isn't in any of these — its `app.sports_follows` rides `ON DELETE CASCADE` from
  `app.users`, which happens to be correct but is nowhere declared or checked.

The failure mode is proven, not hypothetical: the v0.1.0 pre-deploy audit found **export omitted
wellness while deletion purged it** — export/delete parity drifted because two manual lists were
maintained separately. Nothing today prevents a recurrence for the next module.

## Goal

A module declares its export and deletion behavior in its manifest; the settings export pipeline
and the deletion script iterate declarations. A registry assertion makes it impossible to register
a module whose `ownedTables` lack a declared lifecycle. Settings stops reading other modules'
tables.

## Architecture

**One new manifest field, consumed by the two existing hubs.** The hubs keep their jobs
(orchestration, zip/JSON assembly, audit events, download/expiry via `data_export_jobs`); they lose
their per-module knowledge.

1. **Manifest declaration** (`packages/module-sdk/src/index.ts`, new field on
   `JarvisModuleManifest`):

   ```ts
   readonly dataLifecycle?: ModuleDataLifecycleManifest;

   interface ModuleDataLifecycleManifest {
     readonly exportSections?: readonly ModuleExportSection[];
     readonly deletion: ModuleDeletionDecl;
   }

   interface ModuleExportSection {
     readonly key: string; // e.g. "wellness.checkins" — becomes the payload section name
     readonly displayName: string;
     // Runs under the actor's own DataContextDb (RLS-scoped); returns JSON-serializable rows.
     readonly collect: (scopedDb: unknown, ctx: ModuleLifecycleContext) => Promise<unknown>;
   }

   type ModuleDeletionDecl =
     | { readonly strategy: "cascade"; readonly tables: readonly string[] } // FK ON DELETE CASCADE, verified
     | {
         readonly strategy: "purge";
         readonly tables: readonly string[];
         readonly purge: (scopedDb: unknown, ctx: ModuleLifecycleContext) => Promise<void>;
       };
   ```

   `scopedDb` stays `unknown` in the SDK (module-sdk has no `@jarv1s/db` dep); modules narrow it
   via `assertDataContextDb`, the established pattern for assistant tools.

2. **Parity assertion** (`assertModuleRegistryConsistency`,
   `packages/module-registry/src/index.ts:1254-1281`, extended): every table in a manifest's
   `database.ownedTables` MUST be covered by its `dataLifecycle.deletion.tables`. Modules with
   owned tables and **no** `dataLifecycle` fail registration — coverage is opt-out-impossible.
   Export is not forced per-table (some tables are derived caches with nothing user-meaningful to
   export), but a module with owned tables and zero `exportSections` must set an explicit
   `exportSections: []` — visible in review, not an accident of omission.
   For `strategy: "cascade"`, an integration test (not the boot assertion) verifies each listed
   table really has an `ON DELETE CASCADE` FK chain to `app.users` — declared-but-false cascades
   are the dangerous case (sports' `app.sports_follows` becomes the first verified declaration).

3. **Export hub inversion** (`packages/settings/src/data-export*.ts`): the export job iterates
   `getBuiltInModuleManifests()` lifecycle sections and assembles `sectionKey → collect(...)`
   results, replacing the hand-written wellness/tasks/… queries. Sections run under the same
   `withDataContext` actor transaction the hub uses today, so RLS scoping is unchanged. Existing
   worker read-grants (the wellness `0135-0139` migration precedent) stay the modules' own
   responsibility, in their own `sql/` dirs. **Export payload keys must remain byte-compatible**
   with today's output (`wellness.checkins`, `wellness.therapy_notes`, …) — asserted by the
   existing export-format tests; this slice is a refactor, not a format change.
   Wellness's selective HTML export (`export-job.ts`, `data-export-port.ts`) is untouched — this
   spec covers the _full-account_ pipeline only; the wellness port pattern is the design ancestor
   but stays module-internal.

4. **Deletion inversion** (`scripts/delete-user-data.ts:84-87`): the script imports the registry,
   iterates `dataLifecycle.deletion`: `purge` strategies run their hook; `cascade` strategies are
   skipped (the `app.users` delete handles them) but logged. The platform-table list (users, auth,
   preferences, …) stays in the script — it owns platform data; modules own module data.

5. **Migration path:** Phase A: SDK field + assertions + wellness (the richest case) + sports (the
   first cascade declaration). Phase B: sweep remaining data-bearing modules (tasks, notes, goals,
   calendar, email, chat, memory, commitments, people, …), then delete the hub's direct table
   reads. Phase B is mechanical but wide — each module move is verifiable by the byte-compat
   export test.

## Non-goals

- No change to the selective per-module export UX (wellness HTML export).
- No new export formats, no import/restore, no per-module export UI.
- No change to RLS policies or grants; contributions run under existing contexts.
- `packages/settings` keeps orchestration + platform tables; this is not a settings rewrite.

## Verification

- Registry assertion red/green: a test manifest with an owned table and no lifecycle must fail.
- Cascade-truth integration test (attempt: declare cascade on a non-cascading table → red).
- Export byte-compat: full-account export before/after Phase A and each Phase B module is
  deep-equal (fixture-seeded integration test; extend `tests/integration/data-export*`).
- Deletion: `delete-user-data` integration run leaves zero rows for the actor across every
  `ownedTables` entry of every module (generic sweep test replaces per-module assertions).
- `pnpm verify:foundation` green; `foundation.test.ts` migration list updated if any migration is
  added (expect none in Phase A — this is TypeScript-only).

## Risks / open questions

- **Perf:** N `collect` calls vs today's single hand-tuned pass. Acceptable — export is a rare
  async job; keep all sections inside one transaction as today.
- **Settings' remaining reads:** a few genuinely cross-module reads may remain (e.g. chat reading
  `app.provider_install_state`); anything left after Phase B gets an explicit inline justification
  comment or its own follow-up issue — no silent leftovers.
- Open: should `exportSections` also feed the _selective_ export picker in settings UI later? Out
  of scope here; the key/displayName shape deliberately supports it.
