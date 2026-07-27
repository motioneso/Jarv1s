**Dependency:** Task 5 must already be committed.

## Task 6 — Classify Goals

**Files**

- Modify `packages/goals/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`

**Exact classification**

- `granted_at_install`: `goals.create`, `goals.update`, `goals.addEvidence`.
- Add `executionPolicy:"auto"` to all three.
- Add `always_confirm` to `goals_management.allowedTiers`.
- Add `"classifies all 3 Goals write tools as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts`

**Commit**

`feat(goals): classify assistant writes for install grants`

## Stop conditions (apply to every task)

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator.
- Ben rejects or changes the pending `notes.delete` ruling: update Task 7 and the Task 16/17 counts
  before implementation.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
