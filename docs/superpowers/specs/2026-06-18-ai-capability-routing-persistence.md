# AI Capability Routing Persistence

**Status:** Approved
**Date:** 2026-06-18
**Owner:** Ben
**GitHub:** #253

## Goal

Let an admin explicitly choose which configured model handles each AI capability, then make live
capability routing honor that choice.

## Current State

The route lookup is computed only:

- `GET /api/ai/capability-route/:capability` calls `selectModelForCapability`.
- `selectModelForCapability` picks the newest active matching model by tier ladder.
- Settings -> Assistant & AI renders a dropdown for each capability, but `onChange` only shows a
  "Manual routing override is coming soon" toast.

This means the admin can see the computed route but cannot persist or apply an override.

## Scope

Add an admin-only route map:

- Store `capability -> modelId | null` instance-wide.
- `null` or missing means "automatic", preserving current computed behavior.
- Add read/write API:
  - `GET /api/ai/capability-routes`
  - `PUT /api/ai/capability-routes/:capability` with `{ modelId: string | null }`
- Update `GET /api/ai/capability-route/:capability` and all runtime callers of
  `selectModelForCapability` to honor the explicit model first.
- Wire `RouterRow` dropdowns to persist the selected model.

Use the smallest storage path that fits existing patterns. `app.instance_settings` is acceptable for
V1 if it already exists in the AI/settings surface; a dedicated table is acceptable only if the code
would be simpler or needs constraints.

## Routing Rules

When resolving a capability:

1. If an explicit route exists and points at an active model whose provider is active and whose
   capabilities include the requested capability, return it.
2. If the explicit route is missing, null, disabled, revoked, or no longer capability-compatible,
   fall back to the current automatic `selectModelForCapability` behavior.
3. The response should say why the result was chosen:
   - `manual-route`
   - `manual-route-unavailable-fallback`
   - `matched-active-model`
   - `no-active-model`

Do not let a stale route break chat, briefings, tools, or summaries.

## Admin UI

In Settings -> Assistant & AI:

- Add an "Automatic" option to each capability dropdown.
- Persist changes immediately.
- Disable choices that are not active or do not support the capability.
- Show the effective route after mutation using existing query invalidation.
- Remove the placeholder toast and the relevant `NotWired` text for routing.

## Guardrails

- Admin-only writes.
- Reads may remain safe metadata only; do not broaden provider credential exposure.
- Coordinate with #299 provider-list privacy: non-admin responses must not expose more provider
  metadata than they do today.
- Keep the manual route provider-agnostic. Store model IDs, not provider-specific names.
- Runtime fallback must never throw just because the admin-selected model was later disabled,
  deleted, or lost the capability.

## Out Of Scope

- Provider test-connection and model discovery (#252).
- Per-user chat-model override (#241), except both features must compose: user chat override still
  applies only to chat and only when enabled; all other capability routes use this instance map.
- Provider/model creation UX changes.

## Verification

- Unit: resolver returns manual route when valid.
- Unit: resolver falls back when the manual route is missing, disabled, revoked, or lacks capability.
- Integration: non-admin cannot update capability routes.
- Integration: admin can set a manual route and `GET /api/ai/capability-route/:capability` returns
  it with `manual-route`.
- Integration: clearing a route returns to automatic selection.
- UI/manual: changing a dropdown persists, refreshes the route, and survives reload.

## Acceptance Criteria

- Admin capability dropdowns persist and apply.
- Runtime AI capability resolution honors valid manual routes.
- Stale manual routes fail open to automatic routing.
- Provider credentials remain hidden.
- `pnpm verify:foundation` passes.
