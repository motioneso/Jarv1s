**Ruling inserted 2026-07-26 (read before starting): `selfOperationGrant` has THREE values.**
Task 12a adds `"user_promotable"` alongside `"granted_at_install"` and `"confirm_always"`. It means
the tool is fully wired for auto-run but install must **not** promote its family — the family's
`defaultTier` stands and only the user may change it in settings. `calendar.deleteEvent` is the
first and currently only one, per Ben's ruling that deleting a calendar event asks by default
because it emails a cancellation to every attendee.

**Consequences for this task:** the install grant persists `trusted_auto` ONLY for
`granted_at_install` tools. A `user_promotable` tool must be skipped by install exactly as a
`confirm_always` tool is. Any inventory count, roster, or exhaustiveness assertion must cover all
three values, and "every write tool declares something" now has three legal answers, not two.

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
- Ben already ruled on `notes.delete` (granted_at_install, Task 7a) and on `email.sendReply`
  (confirm_always, Task 11). Neither is pending. If a roster or count in this file contradicts
  those rulings or the three-value ruling above, STOP and message the Coordinator — do not
  reconcile it yourself and do not change committed code to match a stale plan line.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
