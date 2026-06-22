# Build Handoff — fix-299-thermo-minors

**Spec (approved):** Issue #299 body is the spec (batched minors from thermo-nuclear review of
PR #273). Read it: `gh issue view 299`
**GitHub issue:** #299
**Risk tier:** `sensitive` (cross-module: touches ai/, chat/, settings/, tasks/, connectors/,
memory/, shared/; shared-contract changes in `tasks-api.ts`/`platform-api.ts`; security-adjacent
dead surfaces — explicit invariant checks apply)
**Worktree:** ~/Jarv1s/.claude/worktrees/fix-299-thermo-minors
**Branch:** fix-299-thermo-minors (off origin/main @ 25c7bd5)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify
`herdr pane list` shows EXACTLY ONE pane with this label before every message)
**Coordinator session id:** `0ee17fb4-0c20-488e-be1e-146d2f9acacb`
**Relay threshold:** ~⅔–¾ context consumed OR after plan-approval + ~5–8 tasks OR on any
compaction summary in your own context.

## Start

1. Confirm `coordinated-build` skill is accessible; if not, open the absolute Build skill path
   above and follow it directly.
2. `[ -d node_modules ] || pnpm install`
3. `gh issue view 299` — read it IN FULL. The issue body is the complete spec of all minors.
4. Invoke **`coordinated-build`**: write plan → escalate to coordinator for approval → build → wrap up.

## Your compact (non-negotiable)

- Work only in this worktree/branch. Stage only your files by name (never `git add -A`).
- Plan approval comes from the coordinator (label `Coordinator`), not a human.
- Escalate immediately on: plan ready, blocker, design fork outside the issue scope, done.
- Never touch the project board, milestones, or merge.
- Caveman mode for all coordinator messages: terse, no filler.

## Build Brief (coordinator-distilled — grounded on `25c7bd5`)

**This is a batch of ~16 mechanical cleanups across 6 modules. Most are straightforward deletes or
extractions. Work through them systematically; treat each as a separate commit.**

**Critical: design question RESOLVED before build**
- **AI provider list endpoint** — `GET /api/ai/providers` or similar route that returns the full
  provider list. Ben's call (recorded in issue #299 comment): **leave as-is**. Do not add an
  admin-only filter on top of RLS. The RLS widening from migration 0091 is intentional. Skip this
  item entirely; it is NOT a build task.

**⚠️ FILE-SIZE LANDMINE (priority: check first before touching these files):**
- `packages/settings/src/routes.ts` is at exactly **1000 lines** (the limit). ANY line added WILL
  trip `pnpm check:file-size`. Run `wc -l packages/settings/src/routes.ts` first; if at or above
  1000, decompose (split by section) BEFORE making changes. The `handleSettingsRouteError` extract
  minor will add lines — must split first.
- `packages/shared/src/platform-api.ts` is at **998 lines**. Treat as effectively at-limit.
  The `RecurrenceSpecDto` addition goes in the shared contract — check this file size too.

**Minors to build (from issue #299 body — read them all):**

*AI / chat:*
- `boundedAssistantToolResultData`: unify the two render+cap paths into one `renderAndCap(schema, result)`.
- PUT chat-model-override: expose `selectableOverrideModels` and validate against it (not `allowedModels`).
- `AiRepository.selectChatModelForUser`: drop if truly a thin pass-through, or document it as canonical.

*Settings:*
- Extract `handleSettingsRouteError` (copy-pasted across 3 route files) to `settings/src/route-error.ts`.
  **⚠️ Decompose `routes.ts` first if at-limit (see above).**
- `SourceBehaviorRoutesDependencies.listModuleManifests?`: make it required (not optional with `?? []`).
- `SourceBehaviorDefault "default-off"`: keep (document) or drop — your call unless product matters.

*Tasks:*
- Delete dead `filterByQuadrant` in `serialize.ts` + its test.
- `getQuadrant` shim: drop or keep as canonical — your call.
- `CreateTaskRequest`/`UpdateTaskRequest.recurrence`: define `RecurrenceSpecDto` in shared contract.
  **⚠️ Check `platform-api.ts` size first (see above).**
- `repository.ts` unreachable recurrence `occurrence_date` branch: delete.
- `taskUpdateStatusExecute.idempotencyKey`: wire through or drop from manifest schema.
- Frontend quadrant mirror (`tasks-view.ts` replicates the important×urgent rule): consider sharing
  the `TASK_QUADRANT_AXES` matrix — this is a `[DESIGN-FORK]` escalation trigger if it impacts
  the `@jarv1s/shared` bundle boundary (no `node:*` imports allowed in the shared browser bundle).

*Connectors / infra:*
- `getOwnedJob`/`cancelOwnedJob` pg-boss wrappers (zero callers): drop if the consuming slice isn't
  live, or add ownership test if keeping.
- `createQueue`-then-`updateQueue` double-call: add a rationale comment or drop redundant `updateQueue`.
- `settings/src/repository.ts recordAuditEvent`: delete if truly orphaned (grep for callers first).
- `backup/restore` scripts: add password validation guard (mirror existing username check).

*Memory:*
- `suppressions-repository.ts`: extract `#mapRow` for parity with `facts-repository.ts`.
- `settings-memory-pane.tsx` Confirm vs Reject asymmetry: flag in a code comment; product decision
  beyond scope — do not change behavior.

**Module isolation check (sensitive tier):**
- Any shared-contract change (`tasks-api.ts`, `platform-api.ts`) must stay backward-compatible or
  all call sites must be updated in the same PR.
- `DataContextDb`-only: all repository changes must accept `DataContextDb`, not raw Kysely.
- Metadata-only payloads: if any pg-boss path is touched, confirm payloads stay metadata-only.

**Decided — do not re-litigate:**
- AI provider list: leave as-is (no admin filter). Skip that item.
- Frontend quadrant matrix sharing: escalate `[DESIGN-FORK]` if it requires modifying `@jarv1s/shared`
  (could violate no-`node:*` constraint or shared-bundle assumption).

**Open for you to decide:**
- `AiRepository.selectChatModelForUser`: drop vs document (low-stakes; use your judgment).
- `SourceBehaviorDefault "default-off"`: keep vs drop (low-stakes; document if keeping).
- `getOwnedJob`/`cancelOwnedJob`: drop vs add ownership test (if you can confirm no consuming slice
  is in-flight or planned, drop is the right call).

**Collision notes:**
- Wave 1, no migration.
- Widest file surface of any Wave 1 item — but all changes are deletes/extractions, no schema
  changes. Other Wave 1 items don't overlap these files.
- This item should NOT rebase until Wave 1 is done (your files don't overlap #317/#318/dogfood, but
  confirm before pushing).

**Verification target:**
- All dead code removed, no regressions.
- `pnpm verify:foundation` passes (every module's tests stay green).
- `pnpm check:file-size` passes (routes.ts and platform-api.ts under 1000 lines post-edit).
