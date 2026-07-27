**Dependency:** Task 12 must already be committed.

## Task 13 — Classify Web Research

**Files**

- Modify `packages/web-research/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/unit/web-research.test.ts`

**Exact classification**

- Add family `web_research_requests`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `web.read`: `granted_at_install`, `risk:"write"`, the new family, and
  `executionPolicy:"auto"`.
- Add `"classifies web.read as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/unit/web-research.test.ts`

**Commit**

`feat(web-research): classify page reads for install grants`

## Stop conditions (apply to every task)

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator.
- Ben rejects or changes the pending `notes.delete` ruling: update Task 7 and the Task 16/17 counts
  before implementation.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
