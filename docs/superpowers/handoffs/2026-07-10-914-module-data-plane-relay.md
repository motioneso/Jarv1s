# Relay — 914-module-data-plane (build agent self-handoff)

**Trigger:** context-meter 70% warning. No code written yet — still in Step ½ (spec-vs-branch
grounding) of `coordinated-build`, about to move to Step 1 (write plan).

## Where to pick up

- **Spec (approved):** `docs/superpowers/specs/2026-07-09-module-data-plane.md` — read in full already.
- **Handoff:** `docs/coordination/handoffs/handoff-914-build.md` — read in full already, do not edit.
- **Branch/worktree:** `build/914-module-data-plane`, this exact worktree. Clean except
  `.claude/context-meter.log` (untouched, ignore it — not part of this work).
- **Coordinator:** label `Coordinator`, session id `4d68fcc5-bc2c-44cd-ae0d-a2e305f94069`. Resolve
  the pane fresh via `herdr pane list` before messaging — never trust a cached `…-N`.
- **Skill:** `coordinated-build` (`.claude/skills/coordinated-build/SKILL.md`). Currently at end of
  Step ½ (grounding). **Next action: run the CLAUDE.md agentmemory recalls, then write the plan via
  `superpowers:writing-plans`, then message the coordinator and STOP for approval before any code.**

## Grounding done — spec premises verified, no drift found

All of spec's "Current state (verified)" claims hold on this branch:
- Global migration head is **0152** (`0152_external_modules.sql`), confirmed via numeric sort of
  `infra/postgres/migrations/*.sql` + all `packages/*/sql/*.sql`. Matches handoff doc.
- `origin/main` unmoved (still `4bc53694`); `gh pr list --search "918"` empty — #918 hasn't landed
  or opened a PR yet.
- `runSqlMigrations`/`assertUniqueMigrationVersions` in `packages/db/src/migrations/sql-runner.ts`
  (217 lines, read in full) is the exact model to parameterize for the new namespaced module ledger
  (`app.module_schema_migrations`, PK `(module_id, version)` instead of bare `version`).
- `jarvis_migration_owner` role is `NOCREATEROLE` (confirmed in
  `infra/postgres/bootstrap/0000_roles.sql`) — validates spec D2's requirement that per-module role
  provisioning must run on a **separate superuser bootstrap connection**, never via the migration
  connection.
- `packages/sports/sql/0133_sports_follows.sql` (read in full) is the exact owned-table RLS pattern
  (ENABLE+FORCE, per-verb `<table>_<verb>` policies, `owner_user_id = app.current_actor_user_id()`)
  that D3's platform-generated RLS/policies must replicate programmatically per module.
- `scripts/migrate.ts` (read in full) and the `migrate` ops-profile Compose service in
  `infra/docker-compose.prod.yml` (lines ~40-75) are the precedent for the new
  `scripts/module-install.ts` + its own ops-profile Compose service (4-phase A/B/C/D structure per
  spec D2 — more complex than migrate.ts's single pass, needs its own script).
- `packages/db/src/data-context.ts` (read in full) confirms `AccessContext { actorUserId,
  requestId? }` and `withDataContext`'s transaction shape — D5's storage RPC must run `SET LOCAL
  ROLE jarvis_mod_<slug>_runtime` **inside** the same transaction `withDataContext` opens, not a
  separate connection.
- **Lifecycle/export pattern (current, pre-D6) fully understood now:**
  `packages/module-sdk/src/index.ts:642-681` defines `ModuleDataLifecycleManifest` (
  `exportSections?: ModuleExportSection[]`, `deletion: ModuleDeletionDecl`),
  `ModuleExportSection` (`key`, `displayName`, `collect: (scopedDb, ctx) => Promise<unknown>` —
  a **function**, confirming the spec's claim this can't survive JSON-manifest serialization for
  external modules), `ModuleDeletionDecl` (`strategy: "cascade"`, `tables: ModuleDeletionTable[]`),
  `ModuleDeletionTable` (`table`, optional `countPredicate`, defaults to `"owner_user_id =
  $1::uuid"` — see `packages/module-registry/src/index.ts:1559-1588`,
  `DEFAULT_MODULE_DELETION_COUNT_PREDICATE` + `getModuleDeletionTables()` +
  `MODULE_DELETION_TABLES` constant, flattens every built-in's `dataLifecycle.deletion.tables`).
  `packages/settings/src/data-export.ts` (read first ~120 lines) shows
  `collectModuleExportSection()` looking up a manifest's `dataLifecycle.exportSections` by
  `moduleId`+`sectionKey` and invoking `section.collect(scopedDb, ctx)` under the actor's own
  `DataContextDb` — this is the exact call shape D6 must replace for external modules with a
  **derived, platform-generated per-table SELECT** (no module-authored `collect` function; instead
  synthesize the section from `database.ownedTables` + the same `SET LOCAL ROLE
  jarvis_mod_<slug>_runtime` helper D5 introduces). `MODULE_DELETION_TABLES` and
  `getModuleDeletionTables()` are the model for how external-module tables get auto-registered into
  `scripts/delete-user-data.ts`'s sweep — D6 says every owned table auto-included via the default
  predicate, which lines up exactly with `DEFAULT_MODULE_DELETION_COUNT_PREDICATE`.
  **Not yet read:** `packages/wellness/src/data-lifecycle.ts` or `packages/sports/src/manifest.ts`
  as a second concrete example (only settings' consumer side read, not a producer side) — optional,
  the pattern is already clear enough to plan from; skip unless the plan-writing step surfaces a gap.

## Resolved: the validate.ts FORBIDDEN_FIELDS question (was flagged as a possible premise conflict — now resolved, not a blocker)

`packages/module-registry/src/external/validate.ts` (read in full) hard-rejects `database` and
`dataLifecycle` (among others) via `FORBIDDEN_FIELDS`, with an explicit comment: "Slice 1 accepts
METADATA ONLY... Any executable or surface-contributing field is rejected so an external module can
never inject nav/routes/tools/SQL **before the slices that safely host those land**." This is
**by design, not drift** — Slice 1 (#917/#818) was always meant to be extended by later slices
(mine is one). It is **not** a contradiction of spec D2's "validate the package with the #818 Slice
1 loader" claim; it means **my Slice 1 (module-data-plane) must extend this validator** (new
allowed fields for `database`, gated correctly — likely via a schemaVersion bump or a distinct
install-time-only validation path that boot-time/discovery-time validation does NOT use, so an
unapproved/uninstalled module on disk still can't smuggle `database` past ordinary discovery). This
is a **plan-writing decision**, not a coordinator escalation — no premise-drift found, spec
premises all verified current. Fold the validator extension into Slice 1 or Slice 2 of the plan
(read `packages/module-sdk/src/index.ts` around `JsonJarvisModuleManifest` /
`schemaVersion` doc comments first to confirm the intended versioning seam before deciding).

## Still open / not yet done

- `packages/module-registry/src/index.ts` was read 1229/1823 lines (offset 0-1228) before
  compaction; **the rest (offset 1229, limit 1228) was never resumed**, though the two specific
  things I needed from it (`MODULE_DELETION_TABLES` definition, `getModuleDeletionTables`) were
  found and read directly via grep+read above. Only resume the full read if plan-writing needs
  `BUILT_IN_MODULES`'s full list, `getBuiltInSqlMigrationDirectories`, `getAllQueueDefinitions`, or
  `getBuiltInModuleManifests` in detail — likely not required; `scripts/migrate.ts` already shows
  the relevant call shape.
- **Migration numbers: not finalized.** Handoff says global head is 0152, #918 provisionally holds
  0153/0154 and is expected to land first — re-check the live head at plan-writing time (`gh pr
  list --search "918"`, re-scan `infra/postgres/migrations/*.sql` + `packages/*/sql/*.sql`) before
  picking numbers for `app.module_schema_migrations` + `app.module_installs`. Working guess was
  0155/0156 — **re-verify, don't assume it's still true**, per handoff's explicit instruction.
- **CLAUDE.md required recalls not yet run.** Before finalizing the plan, run `memory_smart_search`
  for at least: `"jarv1s migration hash placement"`, `"jarv1s accesscontext datacontext"`,
  `"jarv1s RLS shareability policy"`.
- **No plan document exists yet.** Next concrete step: `superpowers:writing-plans` →
  `docs/superpowers/plans/2026-07-10-module-data-plane.md`, structured as the spec's 4 build slices
  (ledger+runner / install entrypoint / generated security / storage RPC+lifecycle), bite-sized TDD
  tasks, exact files, migration numbers resolved, and the validator-extension decision folded in.
- **No coordinator message sent yet, no code written.** After the plan is written: verify exactly
  one `Coordinator`-labeled pane via `herdr pane list`, message it (terse) with the plan path, then
  **STOP and wait for approval** before any TDD work.

## Do not re-do

- Don't re-read the spec or handoff doc top-to-bottom again — both fully internalized above.
- Don't re-litigate the validate.ts finding — it's resolved (extend it, not a conflict).
- Don't re-run `pnpm install` — `node_modules` already present in this worktree.
