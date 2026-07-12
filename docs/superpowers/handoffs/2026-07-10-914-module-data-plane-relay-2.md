# Relay 2 — 914-module-data-plane (build agent self-handoff)

**Trigger:** context-meter 70% warning, mid-relay-1 (never sent the coordinator message before
compaction hit). No code written yet. Still pre-plan.

## Where to pick up

- **Spec (approved):** `docs/superpowers/specs/2026-07-09-module-data-plane.md` — read in full.
- **Prior relay doc:** `docs/superpowers/handoffs/2026-07-10-914-module-data-plane-relay.md` — read
  in full, all grounding findings there still hold. **Do not re-read the spec or that doc
  top-to-bottom again** — both fully internalized. Only new info is below.
- **Coordination handoff (do not edit):** `docs/coordination/handoffs/handoff-914-build.md`.
- **Branch/worktree:** `build/914-module-data-plane`, this exact worktree/path. Clean except
  `.claude/context-meter.log` (pre-existing, out of scope, ignore).
- **Coordinator:** label `Coordinator`, session id `4d68fcc5-bc2c-44cd-ae0d-a2e305f94069`. Resolve
  the pane fresh via `herdr pane list` before messaging — never trust a cached `…-N`. Already sent
  it the relay-2 notice (see below) — **no need to re-message unless you have new material**.
- **Skill:** `coordinated-build`. At end of Step ½ (grounding complete). **Next action: write the
  plan via `superpowers:writing-plans`, message coordinator, STOP for approval before any code.**

## New finding this session: #918 status resolved (partially)

`herdr pane list` shows a pane labeled **"918: open module system slice2 build (relay-1)"**,
`agent_status: "working"`, cwd `/home/ben/Jarv1s/.claude/worktrees/918-implementation-plan` — so
#918 **is** an active build session (contradicts the earlier "just a local plan branch, no
activity" read). Still, `gh pr list`/`git ls-remote` had found no pushed branch or open PR for it.
**Before finalizing migration numbers, re-run:**
```
gh pr list --search "918 in:title,body" --state open
git ls-remote --heads origin | grep -i 918
```
If still no PR/pushed branch, proceed on the handoff's original instruction: take next-free number
after the confirmed live head, expect to land after #918, and be ready to rebase
`foundation.test.ts` + `types.ts` if #918 lands first. Do not hand-resolve conflicts against
#918's branch yourself (coordinator handles at merge per collision notes).

## Everything else (unchanged from relay-1 — re-read that doc, not repeated here)

- Migration head confirmed 0152. `runSqlMigrations`/`sql-runner.ts` model to parameterize.
- `validate.ts` FORBIDDEN_FIELDS finding resolved (extend validator via schemaVersion bump or a
  distinct install-time-only path — not a coordinator escalation).
- Lifecycle/export pattern (module-sdk `ModuleDataLifecycleManifest`/`ModuleExportSection`,
  `module-registry/index.ts` `MODULE_DELETION_TABLES`/`getModuleDeletionTables`,
  `settings/data-export.ts` `collectModuleExportSection()`) fully understood — D6 replaces the
  function-based `collect` with a derived per-owned-table SELECT for external modules.
- `scripts/migrate.ts`, `packages/module-registry/src/node.ts` (`getExternalModuleRegistrations`),
  `packages/db/src/data-context.ts`, `packages/sports/sql/0133_sports_follows.sql` all read in
  full — precedents for `scripts/module-install.ts`, package validation reuse, `withDataContext`
  transaction shape, and generated per-module RLS respectively.

## Still open / not yet done

- Migration numbers: **not finalized** — re-verify live head + #918 real state (see above) before
  picking numbers for `app.module_schema_migrations` + `app.module_installs`.
- CLAUDE.md required recalls (migration hash placement / accesscontext datacontext / RLS
  shareability) — prior attempts returned empty from the memory backend; MEMORY.md index entries
  cover the same ground (Migration Invariants, AccessContext State, RLS Shareability Map) — treat
  those as satisfying the recall requirement, don't loop on empty tool results again.
- **No plan document exists yet.** Next concrete step: `superpowers:writing-plans` →
  `docs/superpowers/plans/2026-07-10-module-data-plane.md`, covering the spec's 4 build slices
  (ledger+runner / install entrypoint / generated security / storage RPC+lifecycle), bite-sized
  TDD tasks, exact files, migration numbers resolved, validator-extension decision folded in.
- No coordinator message sent about the plan yet (only the relay notice was sent). After the plan
  is written: verify exactly one `Coordinator`-labeled pane via `herdr pane list`, message it
  (terse) with the plan path, then **STOP and wait for approval** before any TDD work.

## Do not re-do

- Don't re-read spec/relay-1/handoff docs top-to-bottom again.
- Don't re-litigate the validate.ts finding.
- Don't re-run `pnpm install`.
- Don't re-send the relay notice to the coordinator — already delivered.
