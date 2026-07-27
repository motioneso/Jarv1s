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

**Dependency:** Task 14 must already be committed.

**Coordinator ruling:** #1263 wires built-in enable paths only; external-module self-operation completeness remains scoped to #1267.

## Task 15 — Wire grants into built-in enable paths

**Files**

- Modify `packages/settings/src/routes.ts`
- Modify `packages/settings/src/routes-modules.ts`
- Modify `packages/module-registry/src/index.ts`
- Modify `apps/api/src/server.ts`
- Modify `tests/integration/module-enablement.test.ts`

**Changes**

1. Add a narrow injected `grantSelfOperationForModule(scopedDb, manifest)` port to
   `SettingsRoutesDependencies`; settings must not import AI internals.
2. The composition layer owns one `AiRepository` and supplies the port using the AI helper.
3. Call the port inside the same actor-scoped transaction, after successful enable and before the
   response, in the two built-in branches:
   - `PATCH /api/me/modules/:id` when `disabled:false`;
   - `PATCH /api/admin/modules/:id` when `disabled:false`.
4. Do not touch `/api/admin/external-modules/:id`; external self-operation is #1267.
5. Re-enable/reconcile calls the helper again safely; insert-if-absent preserves a user's
   `always_confirm` override.

**Tests — exact names**

- `"user enable stores trusted_auto for eligible module families"`
- `"admin enable stores grants only for the acting admin"`
- `"re-enable does not overwrite always_confirm"`
- `"disable never mutates action-policy preferences"`
- `"external enable remains outside built-in grant wiring"`

**Verify**

`pnpm vitest run tests/integration/module-enablement.test.ts tests/integration/action-policy-install-grants.test.ts`

**Commit**

`feat(settings): grant self-operation policy on module enable`

## Stop conditions (apply to every task)

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator.
- Ben rejects or changes the pending `notes.delete` ruling: update Task 7 and the Task 16/17 counts
  before implementation.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
