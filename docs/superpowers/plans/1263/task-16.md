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

**Dependency:** Task 15 must already be committed.

**Coordinator ruling:** The four planned `confirm_always` tools are `memory.forget`, `people.merge`, `people.splitIdentity`, and `email.sendReply`, all retaining destructive risk (Ben ruled 2026-07-26: `notes.delete` is granted_at_install, email requires approval). #1263 assertions cover built-ins only; external completeness is #1267, and external family-less writes remain safe because `packages/ai/src/gateway/policy.ts:40` always confirms.

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
   - 33 `granted_at_install`;
   - four `confirm_always`: memory.forget, people.merge, people.splitIdentity, email.sendReply;
   - one `user_promotable`: `calendar.deleteEvent` (Task 12a moved it out of `granted_at_install`,
     which is why the granted count is 33 and not 34);
   - zero unclassified and zero excluded built-in tools;
   - exact planned confirm set `memory.forget`, `people.merge`, `people.splitIdentity`,
     `email.sendReply`.

   **The three counts must sum to 38** — assert that explicitly, so a future reclassification that
   moves a tool between buckets cannot leave the totals silently inconsistent. Note that People
   declares its grants in `packages/people/src/tools.ts`, not a `manifest.ts`; a count derived by
   grepping only `manifest.ts` files comes out at 34 and is wrong.

4. Add readiness regressions named
   `"built-in server startup fails closed on an unclassified built-in write tool"` and
   `"built-in startup assertion deliberately excludes external manifests tracked by #1267"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/unit/self-operation-startup.test.ts`

**Commit**

`feat(api): fail startup on self-operation drift`

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
