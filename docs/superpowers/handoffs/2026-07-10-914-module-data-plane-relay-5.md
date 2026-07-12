# 914-module-data-plane — relay-5 handoff

Spec: `docs/superpowers/specs/2026-07-09-module-data-plane.md` (approved). Plan:
`docs/superpowers/plans/2026-07-10-module-data-plane.md` (written, self-reviewed, **Coordinator
approved** — one required fix applied, see below). Branch `build/914-module-data-plane` in this
exact worktree — continue here, no new worktree. Coordinator label `Coordinator` — resolve pane
fresh via `herdr pane list` each time (do NOT reuse a `…-N` number from this doc).

## State: plan approved, execution not yet started

The plan (9 tasks, Slices 1-4) is complete, self-reviewed (spec coverage / placeholder scan / type
consistency all passed), and was sent to the Coordinator, which approved it with one required fix:
Task 9 Step 6's `readExternalModuleExportRows` originally queried `scopedDb.db` directly, bypassing
`SET LOCAL ROLE jarvis_mod_<slug>_runtime` and the Task 8 `createModuleStorageRpc` helper — this
broke module isolation per spec D6 (the parent runtime role has no ambient grant on module tables,
`WITH INHERIT FALSE`). **This has been fixed in the plan doc**: the export reader now creates a
`createModuleStorageRpc(scopedDb, manifest.id)` per module and routes every read through it, plus
added `assertQualifiedTableName` (now exported from Task 6's `module-rls-emitter.ts`) as an
injection guard on manifest-declared table names before splicing into SQL. Confirmed with the
Coordinator; it replied approving proceeding to build.

**No implementation code has been written yet.** I invoked `superpowers:subagent-driven-development`
and was mid pre-flight (checking for an existing progress ledger — none found at
`.superpowers/sdd/progress.md`, confirmed via `ls`) when this session hit the context checkpoint.

**Uncommitted work in the tree right now:**
- `docs/superpowers/plans/2026-07-10-module-data-plane.md` — new, untracked. NOT yet committed.
- This handoff doc — new, untracked. NOT yet committed.
- `.claude/context-meter.log` — modified (pre-existing tracked file, unrelated housekeeping).

**Immediate next action for whoever resumes:** commit the plan + this handoff doc (explicit paths,
run `pnpm prettier --write` on both first per the handoff-doc-prettier-trap lesson — coordinator
handoffs must be pre-formatted or the agent's own `verify:foundation format:check` fails on them
later and can't be self-fixed), then resume `superpowers:subagent-driven-development` from
scratch — no progress ledger exists, so this is Task 1 of 9, not a resume-in-place.

## Plan task order (final, dependency-correct)

1. `app.module_schema_migrations` migration + foundation test row
2. `app.module_installs` migration + foundation test row
3. Wire-contract validator (`validateModuleMigrationSql`)
4. Migration file loader + ledger read/write helpers
5. Per-module role broker
6. `generateModuleTableRlsSql` + `assertQualifiedTableName` (RLS/policy/grant emitter)
7. `scripts/module-install.ts` (4-phase orchestration — consumes Task 6's emitter)
8. `ctx.db.query` storage RPC (`createModuleStorageRpc`)
9. External-module export section + deletion sweep (consumes Task 6's guard + Task 8's RPC)

Migration numbers: `0155_module_schema_migrations.sql`, `0156_module_installs.sql` (both appended
after the confirmed `0152_external_modules.sql` tail row in `foundation.test.ts`'s migration
`toEqual` array).

## Working design decision (confirmed, not speculative)

External-module owned-table export/deletion lifecycle is derived from the manifest's declared
`database.ownedTables` field + catalog-diff at install (Task 7 Phase B) — **not** a live
`information_schema` scan. This mirrors the existing `assertModuleRegistryConsistency` #801 Phase A
parity convention (`tests/integration/module-registry.test.ts`). This overrides an earlier relay's
self-flagged-as-unverified synthesis about live catalog scanning — do not resurrect that idea.

## Next steps (resume `subagent-driven-development`)

1. Commit the plan + this handoff doc (see "Immediate next action" above).
2. Re-invoke `superpowers:subagent-driven-development` with the plan path. No ledger exists — start
   at Task 1.
3. Continuous execution once started: fresh implementer subagent per task, task-reviewer per task,
   fix loop until clean, then next task. Do not stop to check in between tasks (per the skill's own
   rule) — the only stop conditions are BLOCKED-you-cannot-resolve, genuine ambiguity, or all 9
   tasks complete.
4. After all 9 tasks: dispatch the final whole-branch code reviewer, then
   `superpowers:finishing-a-development-branch`.
5. Message `Coordinator` (pane resolved fresh) at completion or if blocked.

## Tasks (session TaskList — recreate if not visible)

- Plan drafting/self-review/coordinator-approval: DONE
- Task 9 Step 6 privilege-bypass fix: DONE, confirmed with Coordinator
- Execution of plan Tasks 1-9 via subagent-driven-development: NOT STARTED (0/9)
- Final whole-branch review + finishing-a-development-branch: NOT STARTED
