**Dependency:** Task 16 must already be committed.

**Coordinator ruling:** The four planned `confirm_always` tools are `memory.forget`, `people.merge`, `people.splitIdentity`, and `email.sendReply`, all retaining destructive risk (Ben ruled 2026-07-26: `notes.delete` is granted_at_install, email requires approval). #1263 inventory is built-in-only; external completeness is #1267, and external family-less writes remain safe because `packages/ai/src/gateway/policy.ts:40` always confirms.

## Task 17 — Runtime walk-away regression and final gate

**Files**

- Modify `tests/integration/mcp-gateway.test.ts`
- No production files unless this test exposes a defect in an earlier task

**Tests — exact names**

- `"first use after install grant runs without an action card"`
- `"stored always_confirm override still produces an action card"`
- `"the four built-in confirm_always tools remain the only confirmation declarations"`

The first test must persist the grant through the real repository/helper and let the gateway read the
stored tier; a stubbed `getFamilyTier:"trusted_auto"` is insufficient. Assert no `action_request`
event, not merely a successful handler result.

**Verify**

1. `pnpm vitest run tests/unit/self-operation-chassis.test.ts tests/unit/self-operation-manifests.test.ts tests/integration/action-policy-install-grants.test.ts tests/integration/mcp-gateway.test.ts`
2. `pnpm verify:foundation` with its real exit code; never pipe it through `tail`.

**Commit**

`test(ai): prove install grants run card-free`

## Stop conditions (apply to every task)

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator.
- Ben rejects or changes the pending `notes.delete` ruling: update Task 7 and the Task 16/17 counts
  before implementation.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
