# AI Provider And Model Visibility

**Status:** Approved design spec
**Date:** 2026-06-18
**Owner:** Ben
**GitHub:** #299

## Goal

Define which AI provider/model metadata is visible to admins, members, onboarding, and runtime
callers before changing the AI provider-list APIs.

## Current State

The AI API has one provider/model metadata surface today:

- `GET /api/ai/providers`
- `GET /api/ai/models`
- `GET /api/ai/capability-route/:capability`

Those responses are safe in the narrow secret sense: they expose `hasCredential`, never the encrypted
credential payload. But they are not product-scoped by audience. The same provider/model metadata is
used by admin settings, member onboarding, and user-facing model override flows.

That creates the #299 residual: provider-list privacy and provider-model semantics need an approved
contract before implementation.

## Audiences

Use separate contracts by audience:

- **Admin**: full safe metadata needed to manage provider/model configs.
- **Member self**: only metadata about the member's own personal providers, plus safe choices the
  admin has made available for user override.
- **Onboarding**: a boolean/completion-oriented status, not the full provider list.
- **Runtime**: capability routing result only, not arbitrary provider inventory.

Do not solve these by adding flags to one broad DTO and hoping callers ignore fields.

## Admin Contract

Admin settings may see safe provider/model metadata:

- provider id;
- provider kind;
- display name;
- base URL host or a redacted base URL, if needed for debugging;
- status/auth method;
- `hasCredential`;
- model IDs/display names;
- model capabilities, tier, status, and `allowUserOverride`.

Admin responses still must not include:

- credential payloads;
- API keys/tokens;
- raw provider test errors;
- decrypted CLI auth material;
- environment variable values.

Admin writes remain admin-only.

## Member Contract

Members should not receive the instance's full provider inventory by default.

Member-visible surfaces may return:

- whether the member has configured a personal provider;
- the member's own provider configs, if the product supports per-user BYO keys;
- chat-capable models explicitly allowed for user override;
- the effective selected/default chat model, without leaking unrelated provider credentials or
  disabled/internal models.

If a model belongs to an admin-owned/shared provider, the member response should expose only the
model display label, capability/tier needed for selection, and stable model id. Provider display name
is allowed only if Ben wants members to understand vendor/cost tradeoffs; otherwise use a generic
"Instance default" style label.

## Onboarding Contract

Member onboarding should stop deriving completion from the full `listAiProviders()` response.

Add or reuse a narrow endpoint/field for onboarding:

- `hasPersonalAiProvider: boolean`
- `sharedAssistantAvailable: boolean`
- optionally `canAddPersonalProvider: boolean`

This keeps onboarding from depending on provider inventory shape.

## Runtime Contract

Runtime routes should ask for capabilities, not provider lists:

- capability route lookup returns the effective model for a capability;
- chat-model override returns only allowed choices and selected/default state;
- tool/briefing/email paths keep using repository methods under `DataContextDb`.

Runtime callers must not need `GET /api/ai/providers`.

## Implementation Shape

Prefer additive endpoints and DTOs:

- keep or rename the current provider/model list as admin-only;
- add a member-safe AI summary endpoint for onboarding/self settings;
- keep chat-model override responses narrow and allowed-model scoped;
- update web callers to use the narrow endpoint that matches their audience.

Do not migrate data for this slice unless the admin-owned/shared-provider distinction is not already
derivable from existing rows.

## Guardrails

- No secrets in responses, logs, pg-boss payloads, exports, or prompts.
- Non-admin provider inventory must not grow as a side effect of #252 provider test/model discovery
  or #253 capability routing.
- Disabled/revoked providers and disabled models are hidden from member choice lists.
- User override remains opt-in and admin-governed.
- Preserve module isolation: onboarding/settings should call AI-owned APIs, not read AI tables.

## Out Of Scope

- Provider test/model detection (#252).
- Capability route persistence (#253).
- Provider credential editing.
- Cost/budget policy.
- Per-user billing accounting.

## Verification

- Integration: non-admin cannot call admin provider/model inventory routes.
- Integration: member onboarding status returns booleans without provider inventory.
- Integration: member chat override choices include only active, allowed, chat-capable models.
- Integration: revoked/disabled providers do not appear in member-visible choices.
- Contract test: admin DTO contains no credential payload fields.
- UI/manual: admin settings still has management detail; member onboarding and personal settings
  still work from the narrower contracts.

## Acceptance Criteria

- #299 has an approved provider-model/provider-list privacy contract.
- Build agents can implement provider-list privacy without guessing audience semantics.
- Existing provider credentials remain hidden.
- Non-admin AI metadata exposure becomes deliberately narrow.
