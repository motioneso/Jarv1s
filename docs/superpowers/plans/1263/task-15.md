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
