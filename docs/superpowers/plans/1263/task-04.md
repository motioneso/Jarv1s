**Dependency:** Task 3 must already be committed.

## Task 4 — Classify Tasks

**Files**

- Modify `packages/tasks/src/manifest.ts`
- Add `tests/unit/self-operation-manifests.test.ts`

**Exact classification**

- `granted_at_install`: `tasks.create`, `tasks.update`, `tasks.updateStatus`, `tasks.breakDown`,
  `tasks.addActivity`, `tasks.assignTag`, `tasks.unassignTag`, `tasks.createList`,
  `tasks.renameList`, `tasks.createTag`, `tasks.renameTag`, `tasks.deleteList`, `tasks.deleteTag`.
- Add `always_confirm` to `task_changes.allowedTiers`.
- Make `task_cleanup.allowedTiers` include `trusted_auto` and `always_confirm`.
- For `tasks.deleteList` and `tasks.deleteTag`, change risk to write and add
  `executionPolicy:"auto"`; keep `actionFamilyId:"task_cleanup"`. Existing users still confirm
  through the family's declared default until an install grant is stored.
- Add `"classifies all 13 Tasks write tools as granted_at_install"` to the new manifest test.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/tasks-tools.test.ts`

**Commit**

`feat(tasks): classify assistant writes for install grants`

## Stop conditions (apply to every task)

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator.
- Ben rejects or changes the pending `notes.delete` ruling: update Task 7 and the Task 16/17 counts
  before implementation.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
