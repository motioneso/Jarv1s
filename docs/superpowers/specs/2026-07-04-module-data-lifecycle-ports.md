# Module data-lifecycle ports (manifest-declared export/deletion contributions)

**Status:** draft (2026-07-04, rev 2 after adversarial cross-model review) — design spec for task
issue #801, part of epic #798 (module docking seams). Flip #801 to `RFA` once approved.

**Grounded on:** `origin/main` @ `1c307466` (audit findings verified at `2797fc1f`; rev 2 findings
verified at `1c307466`). Re-run `pnpm audit:preflight` before building.

---

## Problem

Full-account export and account deletion are hand-maintained hubs that must be edited every time a
module adds a table:

- `packages/settings/src/data-export.ts:58-59,120-123,768-845` — hand-written queries against
  wellness-owned tables; the file reads ~40 tables spanning every module (calendar, chat,
  commitments, wellness, tasks, goals, memory, email, …) directly, bypassing module repositories.
- `packages/settings/src/data-export-jobs.ts:112-114` — maps module payload sections by hand.
- `packages/settings/src/data-export-async-routes.ts:127` — per-module filename branches.
- `scripts/delete-user-data.ts:84-87` — a hardcoded per-module table list. Note the script's
  actual deletion is **cascade-only today**: it runs a bootstrap `pg.Client`, reads per-table
  counts from that list, checks the admin lock, then issues a single
  `DELETE FROM app.users WHERE id = $1::uuid` and relies on FK cascades. The hardcoded list is
  the count/verification surface, not a purge path.
- Sports isn't in any of these — its `app.sports_follows` rides `ON DELETE CASCADE` from
  `app.users`, which happens to be correct but is nowhere declared or checked.

The failure mode is proven, not hypothetical: the v0.1.0 pre-deploy audit found **export omitted
wellness while deletion purged it** — export/delete parity drifted because two manual lists were
maintained separately. Nothing today prevents a recurrence for the next module.

## Goal

A module declares its export and deletion behavior in its manifest; the settings export pipeline
and the deletion script iterate declarations. A registry assertion makes it impossible to register
a module whose `ownedTables` lack a declared lifecycle. Settings stops reading _migrated_ modules'
tables as each module moves (wellness + sports in Phase A; every remaining direct read is gone
only at the end of Phase B — the acceptance criteria below are phase-specific).

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
     // Top-level property name under the archive's `sections` object — e.g. "wellness".
     // The archive is NESTED (data-export-jobs.ts:90-134 builds e.g.
     // sections.wellness = { checkins, therapy_notes }); a section's collect() returns that
     // exact nested object, so the assembled archive is deep-equal to today's output.
     readonly key: string;
     readonly displayName: string;
     // Runs under the actor's own DataContextDb (RLS-scoped); returns the JSON-serializable
     // section object (nested sub-keys included).
     readonly collect: (scopedDb: unknown, ctx: ModuleLifecycleContext) => Promise<unknown>;
   }

   interface ModuleDeletionDecl {
     readonly strategy: "cascade"; // this slice: cascade-only (see §4)
     readonly tables: readonly ModuleDeletionTable[]; // FK cascade chain to app.users, verified
   }

   interface ModuleDeletionTable {
     readonly table: string; // e.g. "app.wellness_checkins"
     // SQL boolean predicate over $1::uuid (the target user id) for the deletion script's
     // before/after count sweep. Defaults to "owner_user_id = $1::uuid" — the shape ~90% of
     // the script's current list uses. Tables scoped differently declare theirs explicitly,
     // exactly as the script's hardcoded [table, predicate] tuples do today: e.g.
     // "user_id = $1::uuid" (chat_user_memory_settings) or a join
     // ("task_id IN (SELECT id FROM app.tasks WHERE owner_user_id = $1::uuid)" for
     // task_tag_assignments). Code-authored literal, same trust level as the current list.
     readonly countPredicate?: string;
   }
   ```

   `scopedDb` stays `unknown` in the SDK (module-sdk has no `@jarv1s/db` dep); modules narrow it
   via `assertDataContextDb`, the established pattern for assistant tools.

   A `"purge"` strategy with an executable hook was considered and **deferred**: the deletion
   script is a bootstrap `pg.Client` context with no `DataContextRunner`, no RLS actor context,
   and no defined transaction ordering for module hooks — executing module code there would need
   real design (runner construction, failure semantics, ordering vs the `app.users` delete) that
   this slice doesn't require, because every module table today already cascades. If a future
   module genuinely cannot cascade, that spec adds the variant plus the execution design.

2. **Parity assertion** (`assertModuleRegistryConsistency`,
   `packages/module-registry/src/index.ts:1254-1281`, extended): every table in a manifest's
   `database.ownedTables` MUST be covered by its `dataLifecycle.deletion.tables` entries'
   `table` values. Modules with
   owned tables and **no** `dataLifecycle` fail registration — coverage is opt-out-impossible.

   **Phase gating (boot-safety):** the mandatory check cannot be global on day one — **18
   manifests declare `ownedTables` today** and Phase A migrates only wellness + sports; an
   unconditional assertion would fail boot for the other 16. The assertion therefore ships with
   an explicit `LIFECYCLE_MIGRATION_PENDING` allowlist (module ids, hardcoded next to the
   assertion, review-visible): listed modules skip the mandatory-declaration check; unlisted
   modules must declare, and any module that HAS a `dataLifecycle` is fully checked regardless of
   the list. Each Phase B PR removes its module from the list; the final Phase B PR deletes the
   list, making the assertion unconditional. A unit test pins the list's exact contents so a new
   module can't quietly join it — the list only ever shrinks.
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
   responsibility, in their own `sql/` dirs. **The assembled archive must remain byte-compatible**
   with today's nested output — e.g. `sections.wellness` stays the exact
   `{ checkins, therapy_notes }` object, `sections.structured_state` its
   `{ commitments, entities, medications, medication_logs }` object — asserted by a deep-equal
   golden test; this slice is a refactor, not a format change.
   Wellness's selective HTML export (`export-job.ts`, `data-export-port.ts`) is untouched — this
   spec covers the _full-account_ pipeline only; the wellness port pattern is the design ancestor
   but stays module-internal.

4. **Deletion inversion** (`scripts/delete-user-data.ts:84-87`): deletion itself stays exactly
   what it is today — the single `DELETE FROM app.users` plus FK cascades; **no module code runs
   in the script**. What changes is where the table list comes from: it is derived from every
   module's `deletion.tables` (plus the platform-table list, which stays in the script — it owns
   platform data; modules own module data).

   **The script must NOT statically import `@jarv1s/module-registry`** — that would create a
   package cycle: `packages/settings` imports `deleteUserData` from this script
   (`me-account-routes.ts:11`, `routes.ts:41`), and `module-registry` depends on
   `@jarv1s/settings` (`packages/module-registry/package.json`), so a static registry import
   pulls module-registry into settings' own build graph. Instead:
   - `deleteUserData()` gains a
     `moduleDeletionTables: readonly { table: string; countPredicate: string }[]` parameter
     (the default predicate already applied at derivation) — the script's count sweep uses these
     exactly as it uses its hardcoded `[table, predicate]` tuples today (`delete-user-data.ts`
     needs per-table user-scoping predicates — `owner_user_id`, `user_id`, joins — so bare table
     names would not be enough to preserve the count/verification behavior). The API-route
     callers receive the derived list from the composition root (apps/api already holds the
     registry; thread it through `registerSettingsRoutes` deps like every other port).
   - The CLI entrypoint derives the list via a **dynamic `import("@jarv1s/module-registry")`
     inside the already-guarded `main()` path** (the `import.meta.url` guard at
     `delete-user-data.ts:317-323` ensures `main()` never runs when the file is bundled into the
     settings routes, so the dynamic import never executes — and never enters the static graph —
     in that context).

   Declarations feed three checks: the registration-time parity assertion (§2), the cascade-truth
   integration test (§2), and the script's before/after count sweep — so a module whose table
   doesn't actually cascade is caught in CI, not discovered after a deletion request.

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

## Verification (phase-specific — do not enforce Phase B criteria during Phase A)

Phase A (SDK + assertions + wellness + sports):

- Registry assertion red/green: a test manifest with an owned table, no lifecycle, and not on the
  pending allowlist must fail; the same manifest ON the allowlist must boot. Real boot with the
  Phase A tree (16 pending modules) stays green.
- Cascade-truth integration test (attempt: declare cascade on a non-cascading table → red).
- Export byte-compat: full-account export before/after Phase A is deep-equal (fixture-seeded
  integration test; extend `tests/integration/data-export*`). The hub's direct reads of
  wellness/sports tables are gone; **direct reads for not-yet-migrated modules remain and are
  expected** — do not delete them early.
- Deletion: `delete-user-data` integration run leaves zero rows for the actor across every
  declared `deletion.tables` entry of the migrated modules.

Phase B (per module, repeated):

- Same deep-equal export test after each module's move; that module's direct reads deleted in the
  same PR.
- End of Phase B only: zero direct module-table reads remain in `packages/settings` (grep-able
  acceptance check), except explicitly justified cross-module reads (see Risks).

Both phases: `pnpm verify:foundation` green; `foundation.test.ts` migration list updated if any
migration is added (expect none in Phase A — this is TypeScript-only).

## Risks / open questions

- **Perf:** N `collect` calls vs today's single hand-tuned pass. Acceptable — export is a rare
  async job; keep all sections inside one transaction as today.
- **Settings' remaining reads:** a few genuinely cross-module reads may remain (e.g. chat reading
  `app.provider_install_state`); anything left after Phase B gets an explicit inline justification
  comment or its own follow-up issue — no silent leftovers.
- Open: should `exportSections` also feed the _selective_ export picker in settings UI later? Out
  of scope here; the key/displayName shape deliberately supports it.
