# AI Provider Test And Model Detection

**Status:** Approved
**Date:** 2026-06-18
**Owner:** Ben
**GitHub:** #252

## Goal

Make the admin AI provider card useful after a provider is added:

- Test whether the stored provider credential can make a safe provider call.
- Discover available model IDs and suggest capabilities/tiers for admin review.
- Keep manual model registration as the fallback.

## Current State

The provider CRUD path is already real:

- `POST /api/ai/providers` creates CLI or API-key providers.
- `PATCH /api/ai/providers/:id` updates `baseUrl`, `authMethod`, status, and encrypted
  credentials.
- `POST /api/ai/providers/:id/revoke` removes provider use without returning secrets.
- `settings-ai-admin-pane.tsx` can add/edit/remove providers and manually add models.

The missing pieces are the provider-card `Test` action and model auto-detection. The current button
only shows a placeholder toast, and the UI says models are manually registered until auto-detect
lands.

## Scope

Add a narrow admin-only provider validation surface:

- `POST /api/ai/providers/:id/test`
  - Decrypts the provider credential server-side.
  - Performs the cheapest safe validation call for that provider.
  - Returns a redacted result: success/failure, provider kind, and a short safe message.
  - Never returns credentials, raw request URLs, raw provider errors, or response bodies.
- `POST /api/ai/providers/:id/discover-models`
  - Uses the stored provider credential and optional `baseUrl`.
  - Returns candidate model IDs plus suggested capabilities and tier.
  - Does not persist models automatically.
- Admin UI
  - Wire the provider-card `Test` button to the test endpoint.
  - Add a "Discover models" action near the model list.
  - Show discovered candidates with checkboxes or add buttons so the admin chooses what to persist.
  - Preserve the manual "Add model" form.

## Provider Behavior

Use existing provider adapters or add the smallest provider-kind helpers needed.

- API-key providers: validate with a low-cost models/list or metadata call where available.
- OpenAI-compatible providers: honor `baseUrl`.
- Google/Anthropic: do not put API keys in URLs; use headers where supported.
- CLI-auth providers: return a clear unsupported-for-now result unless an existing non-interactive
  CLI status command is already available.

Model suggestions may use a conservative heuristic:

- model IDs containing chat/general models -> `chat`, `tool-use`, `json`, `summarization`;
- model IDs or provider metadata indicating vision -> add `vision`;
- unknown models default to `chat` + `interactive`.

This heuristic is intentionally replaceable later; the admin reviews before persistence.

## Out Of Scope

- CLI re-auth flow. That can launch local commands and needs a separate UX/security spec.
- Rebuilding credential editing. It already exists via `updateAiProvider`.
- Capability-routing persistence. That belongs to #253.
- Non-admin provider metadata exposure. Coordinate with #299 and do not broaden non-admin responses.

## Guardrails

- Admin-only for both endpoints.
- Execute under the existing data-context/RLS boundaries.
- Never log or return provider credentials.
- Normalize provider failures to safe messages. Keep detailed raw errors out of responses/toasts.
- Do not mutate model rows from discovery until the admin explicitly confirms candidates.
- Keep revoked providers untestable.

## Verification

- Unit: redaction helper never includes API keys, bearer tokens, raw URLs with query secrets, or raw
  provider error bodies.
- Integration: non-admin cannot call test/discover endpoints.
- Integration: admin can test an API-key provider and gets a safe pass/fail result.
- Integration: discover returns candidates without inserting model rows.
- UI/manual: Test button shows loading/pass/fail; discover candidates can be selectively added; manual
  model add still works.

## Acceptance Criteria

- #252 has a buildable first slice for provider test + model discovery.
- Credential editing remains unchanged.
- CLI re-auth is documented as a separate follow-up, not hidden inside this task.
- `pnpm verify:foundation` passes.
