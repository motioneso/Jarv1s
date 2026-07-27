**Dependency:** Task 8 must already be committed.

**Coordinator ruling:** The four planned `confirm_always` tools are `memory.forget`, `people.merge`, `people.splitIdentity`, and `notes.delete`; all retain destructive risk. `notes.delete` remains pending Ben's confirmation.

## Task 9 — Classify Memory

**Files**

- Modify `packages/memory/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/memory-graph-tools.test.ts`

**Exact classification**

- Add family `memory_management`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `memory.remember`: `granted_at_install`, `risk:"write"`,
  `actionFamilyId:"memory_management"`, `executionPolicy:"auto"`.
- `memory.forget`: `confirm_always`, retaining destructive risk; this preserves the existing
  destructive floor.
- Add `"classifies remember as granted and forget as binding confirm_always"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/memory-graph-tools.test.ts`

**Commit**

`feat(memory): declare assistant self-operation grants`

## Stop conditions (apply to every task)

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator.
- Ben rejects or changes the pending `notes.delete` ruling: update Task 7 and the Task 16/17 counts
  before implementation.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
