# Spec — Owner bootstrap recovery (#260)

**Status:** approved (Ben, 2026-06-18)
**Issue:** #260
**Tier:** `security` (first owner/admin privilege assignment)
**Migration:** avoid if possible. If schema changes become necessary, add a new forward migration;
never edit applied migrations.

## Problem

`bootstrapFirstJarvisUser` currently promotes a signup to `is_instance_admin=true` and
`is_bootstrap_owner=true` only when `app.count_all_users()` reports exactly one user after the
insert.

That works for a brand-new empty database, but it fails for a restored, seeded, or probe-touched
database that already has user rows and no owner. The intended owner signs up as a pending
non-admin under `registration.requires_approval=true`, leaving the instance with no owner/admin to
approve them.

## Locked Decision

Do not key first-owner bootstrap on literal empty database row count.

If no bootstrap owner exists yet, the next signup is the first-run owner setup path:

- `status = active`
- `is_instance_admin = true`
- `is_bootstrap_owner = true`
- no pending admin approval gate

Once a bootstrap owner exists, preserve the existing normal registration behavior:

- if `registration.requires_approval=true`, later users land pending;
- if approval is disabled, later users land active;
- later users do not become bootstrap owners automatically.

Important product nuance: instance owner and instance admin do not have to remain the same person
forever. This spec only fixes first setup/recovery when no owner exists.

## Scope

- Update the bootstrap decision in `packages/auth/src/index.ts` so it checks for absence of an
  existing bootstrap owner instead of `count_all_users() === 1`.
- Keep the existing advisory transaction lock so concurrent signups cannot both become owner.
- Keep the existing `DataContextRunner.withDataContext` transaction/GUC boundary.
- Keep audit behavior for the user who becomes bootstrap owner.
- Add integration coverage for a non-empty DB with no owner.
- Preserve the existing pending-user behavior when a bootstrap owner already exists.

## Out Of Scope

- In-app owner transfer UI.
- Operator CLI/admin recovery script.
- Broader owner/admin role model changes.
- Alternative auth provider work.

## Guardrails

- Do not weaken RLS or the `DataContextDb` invariant.
- Do not use a root app DB handle for new bootstrap reads/writes.
- Do not leak auth/session secrets in responses, logs, or docs.
- Do not edit applied migrations.
- Treat merge as security-tier: coordinator must get Ben sign-off before merging.

## Verification

- Integration: seed one or more non-admin, non-bootstrap-owner users; sign up a new user while
  `registration.requires_approval=true`; assert the new user is active, instance admin, and
  bootstrap owner.
- Integration: when a bootstrap owner already exists and approval is required, a later signup still
  lands pending and non-owner.
- Regression: existing empty-DB first signup behavior still works.
- Local gate: `pnpm verify:foundation` and `pnpm audit:release-hardening`.
