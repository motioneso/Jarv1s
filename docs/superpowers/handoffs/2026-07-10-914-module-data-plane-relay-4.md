# 914-module-data-plane — relay-4 handoff

**Supersedes relay-3 for grounding-read status; relay-3's RESOLVED sections (migration numbers
0155/0156, file structure, "still open" list) are still authoritative — read relay-3 in full too.**
Spec: `docs/superpowers/specs/2026-07-09-module-data-plane.md` (approved). Build handoff:
`docs/coordination/handoffs/handoff-914-build.md` (risk tier `security`). Branch
`build/914-module-data-plane` in this exact worktree — continue here, no new worktree.
Coordinator label `Coordinator` — resolve pane fresh via `herdr pane list` each time (do NOT
reuse a `…-N` number from this doc).

## State: plan NOT yet written

No file exists at `docs/superpowers/plans/2026-07-10-module-data-plane.md` — confirmed via `ls`.
Zero code/plan content written this session. Relayed at context-meter 70% during the grounding-read
phase, immediately before starting to draft the plan. Coordinator already notified (relay-4
message sent to `Coordinator` pane, delivered/queued).

**Do NOT delegate plan-drafting to a fork subagent** — two attempts this session both failed
(returned in ~5s with 0 tool calls / status placeholder text, then killed with no output on
retry). Draft the plan directly in-session.

## Grounding reads already done (do not re-read these — content is stale-safe, just re-open if you
need exact line numbers)

Full reads: spec, relay-3 handoff, `handoff-914-build.md`, `sql-runner.ts`, `db/src/index.ts`,
`data-context.ts`, `0000_roles.sql`, `packages/sports/sql/0133_sports_follows.sql`, `migrate.ts`,
`packages/module-registry/src/external/validate.ts` (full), `.../external/types.ts` (full),
`role-bootstrap.ts` (full), `tests/unit/external-hash.test.ts` (full — unit test style precedent:
`mkdtempSync`/`rmSync` fixture, one `describe` per pure fn), `tests/integration/test-database.ts`
(full — `resetFoundationDatabase`/`resetEmptyFoundationDatabase`/`setInstanceSetting`/`ids` fixture;
decide whether module-install integration tests reuse this or get their own reset helper),
`infra/docker-compose.prod.yml:1-60` (migrate service template for the new `module-install` ops
service), `module-registry/src/index.ts:430-460,1540-1654` (`BuiltInModuleRegistration`,
`getModuleDeletionTables`/`MODULE_DELETION_TABLES`/`getBuiltInSqlMigrationDirectories`),
`module-sdk/src/index.ts:530-574` (`JsonJarvisModuleManifest`, `ExternalJarvisModulePackage`),
`settings/src/data-export.ts:80-139` (`collectModuleExportSection<T>`, start of `readExportTables`,
`wellness` as worked export-section example), `foundation.test.ts` tail (migration `toEqual` array
ends `{version:"0152", name:"0152_external_modules.sql"}`).

Grep only (not read): `scripts/audit-release-hardening.ts` has `protectedTables` (line 32) and
`protectedTablesWithWorkerDelete` (line 61) — 17 total matches for deletion-table terms; NOT yet
read in full. `scripts/delete-user-data.ts` line 21 references
`getModuleDeletionTables`/`MODULE_DELETION_TABLES` from `@jarv1s/module-registry` — confirms this
is the consumption point Slice 4 must extend for external modules.

`tests/integration/module-registry.test.ts` (185 lines) — first 80 lines read: fixture helpers
`manifest()`/`registration()`, `assertModuleRegistryConsistency` tests (duplicate module id / queue
name / route). Confirms the `BuiltInModuleRegistration` fixture shape to reuse in new Slice 2/3
tests. **Read the rest (lines 80-185) before writing Slice 2/3 test tasks** — relay-3 flagged this
file as unread; it likely has the "duplicate owned tables" / #801 parity check test worth mirroring
for external-module registration.

## Still needed before the plan can have zero placeholders

1. Rest of `packages/settings/src/data-export.ts` (beyond line 139) — full `UserDataExportTables`
   shape + orchestrating function, for the Slice 4 derived-export-generator task's exact code.
2. `tests/integration/module-registry.test.ts` lines 80-185.
3. Full `JarvisModuleManifest` compiled type in `module-sdk/src/index.ts` (its `database`/
   `dataLifecycle` field shapes) + `ModuleAuthDeclaration`/`ModuleStorageDeclaration`/
   `ModuleCompatibility` — needed for exact `database.ownedTables` / `dataLifecycle.deletion.tables`
   / `exportSections` shapes the plan generates against.
4. Read (not just grep) `scripts/audit-release-hardening.ts` around `protectedTables` (line 32) —
   confirm whether/how this plan must touch it (coordinator handoff says "possibly, minor").

## Working design decision (not yet in the spec verbatim — my synthesis, re-verify against spec
before locking into the plan)

For Slice 4 (derived export/deletion for *external* modules, since no `collect()` fn can exist in
a JSON manifest): discover each installed external module's owned tables **from the catalog at
request time**, not from a stored table list — `SELECT table_name FROM information_schema.tables
WHERE table_schema='app' AND table_name LIKE <table_prefix> || '%'`, using `app.module_installs`'s
`table_prefix` column (spec data model) to join. This avoids a second source of truth diverging
from actual schema state, and is consistent with D3's catalog-diff-is-ground-truth philosophy.
Mirror this for deletion: a new `getExternalModuleDeletionTables(dbClient)` queried at delete-time
in `scripts/delete-user-data.ts`, combined with the existing static `MODULE_DELETION_TABLES` (which
stays built-in-only, computed eagerly at module-registry load — external modules install
post-deploy so can't be in a static snapshot). **Verify this against spec Decision D6 and the Data
model section before writing the task — I have not re-read D6 fresh this session, this is
carried-forward reasoning from the file reads above.**

## Next steps (resume `coordinated-build` Step 1)

1. Do reads 1-4 above.
2. Write `docs/superpowers/plans/2026-07-10-module-data-plane.md` via `superpowers:writing-plans`
   — bite-sized TDD tasks, complete code every step, covering spec Slices 1-4 + full Verification
   section. Use relay-3's RESOLVED migration numbers (0155/0156) and file-structure section.
3. Self-review per the skill (spec coverage / placeholder scan / type consistency).
4. Message `Coordinator` (pane resolved fresh) with the plan path. **STOP for approval — no code
   until the coordinator approves.**

## Tasks (session TaskList — recreate if not visible)

- #1 in_progress: draft the plan (this doc's "Next steps" 1-3)
- #2 pending: self-review the plan
- #3 pending: message Coordinator with plan path, then stop
