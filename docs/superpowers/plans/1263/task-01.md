**Dependency:** None.

**Status:** DONE — `b2840f7b`.

## Task 1 — Add the public SDK declaration

**Files**

- Modify `packages/module-sdk/src/index.ts`
- Modify `tests/unit/mcp-gateway-units.test.ts`

**Changes**

1. Export
   `ModuleAssistantToolSelfOperationGrant = "granted_at_install" | "confirm_always"`.
2. Add optional
   `readonly selfOperationGrant?: ModuleAssistantToolSelfOperationGrant`
   to `ModuleAssistantToolManifest`. It remains optional at the TypeScript level because read tools
   do not declare it; the runtime/build assertion enforces it for writes.
3. Do not change `JarvisActionPermissionTier` or
   `ModuleAssistantActionFamilyManifest.defaultTier`.
4. In the existing `"module-sdk tool contract"` describe block, add
   `"accepts the selfOperationGrant vocabulary without widening action tiers"` and compile fixtures
   for both values.

**Verify**

`pnpm vitest run tests/unit/mcp-gateway-units.test.ts`

**Commit**

`feat(module-sdk): declare self-operation grants`

## Stop conditions (apply to every task)

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator.
- Ben rejects or changes the pending `notes.delete` ruling: update Task 7 and the Task 16/17 counts
  before implementation.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
