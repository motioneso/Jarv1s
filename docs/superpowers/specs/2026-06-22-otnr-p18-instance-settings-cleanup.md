# OTNR-P18: Typed Instance Settings Registry and Generic Admin KV Cleanup

**Issue:** #156
**Status:** Approved for build
**Date:** 2026-06-22
**Milestone:** Backlog · Post-MVP & Deferred

## Problem

`PATCH /api/admin/settings/:key` allows arbitrary JSON to be written to `app.instance_settings`
under any free-form key. This is an open admin write surface — untyped, unvalidated, and
inconsistent with the typed-route ownership model used everywhere else.

## Already resolved (do not re-do)

- `SettingsRepository` already accepts `DataContextDb` per method.
- `app.instance_settings` and `app.admin_audit_events` have `ENABLE` + `FORCE` RLS.
- Workspace/resource-grant tables removed.
- Last-admin/owner guardrails hardened separately.

## Remaining build scope

1. **Typed key registry** — define a `InstanceSettingsKey` enum / const map listing every
   legitimate `app.instance_settings` key currently in use (registration settings, chat
   multiplexer config, onboarding state, etc.).

2. **Retire generic writer** — remove or fail-close `PATCH /api/admin/settings/:key`. Replace
   with dedicated typed routes for each key group, or a validated `PATCH` that rejects any
   key not in the registry.

3. **Safe list endpoint** — `GET /api/admin/settings` returns only registered, non-secret
   values. No arbitrary JSON echo; credential/secret keys are excluded by the registry.

4. **Route plumbing cleanup** — schema-backed request body typing on settings routes;
   remove duplicate parsers; narrow admin-gate selects where practical (no behavior change,
   just tightening).

## Out of scope

- Settings UI backend (#234 and children).
- New settings surfaces.
- Any migration — this is code-only unless schema changes are forced by (4).

## Acceptance

- `PATCH /api/admin/settings/arbitrary_unknown_key` → 400 or 404.
- All existing typed settings behavior (registration, chat multiplexer, onboarding) passes
  integration tests.
- Settings write audit metadata remains value-free (no secret values in audit rows).
- `pnpm verify:foundation` passes.
