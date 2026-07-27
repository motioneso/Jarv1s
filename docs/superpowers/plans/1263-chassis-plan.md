# Issue #1263 — module self-operation chassis implementation plan

**Builder rule:** Read exactly one linked task file at a time; never read this index's task list in
full before executing.

**Binding inputs:** `docs/coordination/handoff-1263-self-operation-chassis.md`, then
`docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md`.

**ESCALATION — Ben confirmation pending:** `notes.delete` performs a bare unlink with no trash,
soft-delete, or restore path. The Coordinator has surfaced it to Ben as a fourth
`confirm_always`; this plan includes it pending Ben's confirmation. Do not treat the count as settled
or substitute a risk reclassification. Any fifth candidate is escalated before implementation.

The Coordinator ruled #1263 **built-in only**. External-module self-operation ABI completeness is
tracked by #1267 under epic #1262. Existing external writes remain fail-safe meanwhile: they cannot
declare an action family, so `packages/ai/src/gateway/policy.ts:40` confirms them forever.

The Coordinator also ruled that exclusion rule 7 governs new self-operation/configuration
operations, not retroactive removal of shipped domain tools. Email and Calendar remain
`granted_at_install`. Where rule 7's examples collide with Ben's explicit per-tool classifications,
the per-tool ruling wins; this applies to all five News writes in Task 10.

## Verified baseline and non-negotiable decisions

- Add `selfOperationGrant`, not `selfOperationTier`, to the public SDK manifest. Its values are
  `"granted_at_install" | "confirm_always"`; they are not
  `JarvisActionPermissionTier` values. Do not widen `defaultTier`.
- `packages/ai/src/gateway/policy.ts` stays behaviorally unchanged. Its current order is destructive
  → confirm, no family → confirm, stored tier over declared default, then
  `trusted_auto + executionPolicy:"auto" + allowedTiers` → run.
- The gateway order becomes excluded → unavailable/deny, then YOLO → run, then ordinary policy.
  YOLO must continue to bypass `confirm_always`, destructive risk, and
  `requiresConfirmation`.
- The action-policy store already exists in `app.preferences` at
  `assistant.action_policy.v1.<moduleId>.<familyId>`. Add an insert-if-absent repository method;
  **do not add a migration** and do not reuse the clobbering `setActionPolicy` upsert.
- `PATCH /api/ai/action-policy/:moduleId/:actionFamilyId` rejects tiers absent from
  `allowedTiers`; every family touched here must therefore include `always_confirm`, and every
  `granted_at_install` family must also include `trusted_auto`.
- A `granted_at_install` tool must be `risk:"write"`, have an `actionFamilyId`, and use
  `executionPolicy:"auto"`. Otherwise the existing policy path still prompts. Existing destructive
  tools classified as granted are reclassified to write; their default family tier still preserves
  confirmation for existing users without an install grant.
- Built-in inventory is **38 actual tools across 10 packages**, not 39/11. The 39th grep match is
  the type-only narrowing at `packages/ai/src/routes.ts:647`; `ai.explainRecentErrors` is read-only.
  The assertion and inventory tests must say **built-in** explicitly. External completeness is
  #1267.
- The People round trip is not a reverse: `PeopleRepository.mergePeople` moves every identity and
  link and marks the secondary row merged; `PersonContextService.splitIdentity` moves one identity
  and never revives that row or restores its other identities/links. Preserve both tools as
  destructive and declare `confirm_always`, exactly like `memory.forget`.
- `notesDeleteExecute` (`packages/notes/src/write-tools.ts:232`) calls `unlink(file)` directly.
  Preserve `notes.delete` as destructive and plan its fourth `confirm_always` declaration pending
  Ben's confirmation.
- Do not ship assistant settings tools, a parallel command registry, a migration, the #1266 revoke
  UI, the external-module ABI tracked by #1267, CAS/undo/audit/rate-limit work for later settings
  commands, or a release note claiming direct user-visible behavior.

## Task index

| Task | Title | File | Dependency |
| --- | --- | --- | --- |
| 1 | Add the public SDK declaration | `docs/superpowers/plans/1263/task-01.md` | None |
| 2 | Implement the one central exclusion artifact and manifest assertion | `docs/superpowers/plans/1263/task-02.md` | Task 1 |
| 3 | Enforce exclusions before YOLO without changing YOLO | `docs/superpowers/plans/1263/task-03.md` | Task 2 |
| 4 | Classify Tasks | `docs/superpowers/plans/1263/task-04.md` | Task 3 |
| 5 | Classify Commitments | `docs/superpowers/plans/1263/task-05.md` | Task 4 |
| 6 | Classify Goals | `docs/superpowers/plans/1263/task-06.md` | Task 5 |
| 7 | Classify Notes | `docs/superpowers/plans/1263/task-07.md` | Task 6 |
| 8 | Classify People with the binding destructive ruling | `docs/superpowers/plans/1263/task-08.md` | Task 7 |
| 9 | Classify Memory | `docs/superpowers/plans/1263/task-09.md` | Task 8 |
| 10 | Classify News | `docs/superpowers/plans/1263/task-10.md` | Task 9 |
| 11 | Classify Email | `docs/superpowers/plans/1263/task-11.md` | Task 10 |
| 12 | Classify Calendar | `docs/superpowers/plans/1263/task-12.md` | Task 11 |
| 13 | Classify Web Research | `docs/superpowers/plans/1263/task-13.md` | Task 12 |
| 14 | Persist install grants without clobbering user policy | `docs/superpowers/plans/1263/task-14.md` | Task 13 |
| 15 | Wire grants into built-in enable paths | `docs/superpowers/plans/1263/task-15.md` | Task 14 |
| 16 | Wire the built-in assertion at startup and lock the inventory | `docs/superpowers/plans/1263/task-16.md` | Task 15 |
| 17 | Runtime walk-away regression and final gate | `docs/superpowers/plans/1263/task-17.md` | Task 16 |

## Builder stop conditions

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator.
- Ben rejects or changes the pending `notes.delete` ruling: update Task 7 and the Task 16/17 counts
  before implementation.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
