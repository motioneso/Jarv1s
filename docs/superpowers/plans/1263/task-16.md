**Dependency:** Task 15 must already be committed.

**Coordinator ruling:** The four planned `confirm_always` tools are `memory.forget`, `people.merge`, `people.splitIdentity`, and `notes.delete`, all retaining destructive risk, with `notes.delete` pending Ben. #1263 assertions cover built-ins only; external completeness is #1267, and external family-less writes remain safe because `packages/ai/src/gateway/policy.ts:40` always confirms.

## Task 16 — Wire the built-in assertion at startup and lock the inventory

**Files**

- Modify `apps/api/src/server.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify the closest existing `createApiServer` readiness test, or add
  `tests/unit/self-operation-startup.test.ts` if no focused readiness fixture remains small

**Changes**

1. Call `assertBuiltInSelfOperationManifests(getBuiltInModuleManifests())` before the server can
   become ready. Never pass external manifests.
2. Keep the assertion's doc comment and startup call explicit that #1263 covers built-ins only;
   cite #1267 and `policy.ts:40`.
3. Add the complete built-in inventory test:
   - 38 write/destructive tools;
   - 34 `granted_at_install`;
   - four planned `confirm_always`, with `notes.delete` pending Ben;
   - zero unclassified and zero excluded built-in tools;
   - exact planned confirm set `memory.forget`, `people.merge`, `people.splitIdentity`,
     `notes.delete`.
4. Add readiness regressions named
   `"built-in server startup fails closed on an unclassified built-in write tool"` and
   `"built-in startup assertion deliberately excludes external manifests tracked by #1267"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/unit/self-operation-startup.test.ts`

**Commit**

`feat(api): fail startup on self-operation drift`

## Stop conditions (apply to every task)

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator.
- Ben rejects or changes the pending `notes.delete` ruling: update Task 7 and the Task 16/17 counts
  before implementation.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
