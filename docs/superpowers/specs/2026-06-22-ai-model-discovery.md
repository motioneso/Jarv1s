# AI model discovery — Anthropic + OpenAI-compatible `/models` endpoint

**Status:** Approved design — ready to build
**Date:** 2026-06-22
**Owner:** Ben
**GitHub:** #423
**Grounded on:** `origin/main` @ `15448ba` (current branch `docs/update-stale-documentation`,
docs-only ahead, source tree unchanged).
**Builds on:** ADR-0008 (capability router design, provider-agnostic).

---

## Goal

Replace the manual `provider_model_id` text field in AI Settings with a discovery-based flow:
connect a provider → Jarvis fetches the available model list → user picks which to add with tier
assignment. Model lists stay current without code deploys.

Success = in Settings on the deployed instance: adding an Anthropic or openai-compatible
provider shows a list of models fetched from the live API; checking a model and saving writes it
to `ai_configured_models`; if the API is unreachable a static fallback list appears and a warning
banner explains it; `pnpm verify:foundation` green.

---

## Design decisions (interview-confirmed)

| #   | Decision                                                                                |
| --- | --------------------------------------------------------------------------------------- |
| D1  | Anthropic **and** openai-compatible providers both get discovery in this build          |
| D2  | Cache: **in-process memory**, TTL 1 hour, per (userId, providerId). No DB table needed. |
| D3  | Fallback: static allowlist of known current models when the provider API is unreachable |
| D4  | Provider-agnostic architecture preserved — no provider-specific logic in feature code   |

---

## Architecture

### New API endpoint: `GET /api/ai/providers/:id/models/discover`

Authenticated (requires `ai.manage` permission). Returns a list of models available for the
given provider config, drawing from the discovery cache (populating it on miss).

Response shape:

```typescript
{
  models: Array<{
    providerModelId: string; // e.g. "claude-sonnet-4-6"
    displayName: string; // human-readable, from provider response or derived
    fromCache: boolean; // true if TTL cache hit
    fromFallback: boolean; // true if provider API was unreachable; static list served
  }>;
  cacheExpiresAt: string | null; // ISO timestamp; null when fromFallback
}
```

### Discovery service (`packages/ai/src/model-discovery.ts`)

In-process `Map<string, { models: DiscoveredModel[]; expiresAt: number }>` keyed by
`"${userId}:${providerId}"`. Cache TTL: 3 600 000 ms (1 hour).

```typescript
interface ModelDiscoveryService {
  discoverModels(
    provider: AiProviderConfigSafeRow & { readonly encrypted_credential: EncryptedAiSecret },
    actorUserId: string
  ): Promise<{ models: DiscoveredModel[]; fromFallback: boolean }>;

  invalidate(actorUserId: string, providerId: string): void;
}
```

#### Per-provider fetch strategy

**Anthropic** (`provider_kind === "anthropic"`):

- `GET https://api.anthropic.com/v1/models`
- Auth header: `x-api-key: <decrypted_credential>`
- Filter: include only models where `id` contains `"claude-"` and does not contain a legacy
  version separator (`:`) — avoids surfacing deprecated snapshot versions.
- Map response `id` → `providerModelId`, `display_name` → `displayName`.

**OpenAI-compatible** (`provider_kind === "openai-compatible"`):

- `GET {base_url}/v1/models`
- Auth header: `Authorization: Bearer <decrypted_credential>`
- No filter — the provider's own response is the authority; show everything returned.
- Map `id` → `providerModelId`; derive `displayName` from `id` if `name` is absent.

**Google** (`provider_kind === "google"`): not in scope — different API format, deferred.

**Ollama** (`provider_kind === "ollama"`): not in scope — `/api/tags` has a different shape,
deferred.

#### Fallback static list

When the provider API call fails (network error, 401, 5xx):

- **Anthropic**: a curated list of current production models (maintained as a constant in
  `packages/ai/src/model-discovery.ts`). Update the list when Anthropic releases major new
  models; the live API fetch keeps everyday usage current between code deploys.
- **openai-compatible**: empty list with a "could not reach provider" message — no sensible
  static fallback since base URLs are user-configured and model IDs vary by deployment.

### Settings UI changes (`apps/web/src/settings/settings-ai-admin-pane.tsx`)

Removes the `BACKEND-TODO` comment and the manual `AddModelForm` (the text input for
`provider_model_id`). Replaces it with a **Discover models** flow on the provider card:

1. **Provider card gains a "Discover models" button** (or auto-triggers on first expand after
   provider connect).
2. **Clicking it** calls `GET /api/ai/providers/:id/models/discover`; shows a loading state.
3. **On success:** renders a checklist of discovered models, each with:
   - Model ID and display name
   - Tier selector (interactive / reasoning / economy — same tiers as the existing manual form)
   - Capability checkboxes (chat, etc.)
   - A "fromFallback" warning banner if the static list was served: "Could not reach the
     provider's model list — showing known models. Check your API key."
4. **User checks models to add** → "Add selected" → `POST /api/ai/models` for each → invalidates
   discovery cache for this provider → `queryKeys.ai.models` invalidated as before.
5. **Already-configured models** appear pre-checked and greyed out (de-duplicate by
   `providerModelId`).

The `NotWired` banner on the routing section stays — capability routing persistence is a separate
issue (#253), not in scope here.

### Cache invalidation

`invalidate(actorUserId, providerId)` is called:

- After the user successfully adds models (so a fresh Discover triggers a live refetch).
- After `PATCH /api/ai/providers/:id` (provider credentials updated).
- After `POST /api/ai/providers/:id/revoke`.

---

## Provider-agnostic invariant

No feature code outside `model-discovery.ts` references provider kinds. The discovery service
returns a uniform `DiscoveredModel[]` regardless of the upstream API. The Settings UI calls the
single `/discover` endpoint and never speaks directly to Anthropic or any other provider.

---

## Out of scope

- Google (`provider_kind === "google"`) — different API, deferred
- Ollama (`provider_kind === "ollama"`) — different API, deferred
- Periodic background refresh / push notifications when new models appear
- Capability inference from model metadata (deferred to capability routing spec #253)
- Removing the manual `AddModelForm` entirely before this ships — keep it as a fallback path
  behind a small "Add manually" escape hatch for providers whose `/models` endpoint is absent

---

## Acceptance criteria

- [ ] `GET /api/ai/providers/:id/models/discover` returns models fetched from Anthropic live API
      for an Anthropic provider with a valid key
- [ ] Same endpoint returns models from `{base_url}/v1/models` for an openai-compatible provider
- [ ] Results are cached in-process for 1 hour; a second call within the TTL does not hit the
      provider API (`fromCache: true` in response)
- [ ] When the provider API is unreachable, Anthropic providers receive the static fallback list
      with `fromFallback: true`; UI shows the warning banner
- [ ] Discovered models can be added with tier + capability assignment; they appear in the
      models list and are selectable for chat
- [ ] Already-configured models are shown pre-checked and cannot be double-added
- [ ] `BACKEND-TODO` comment at `settings-ai-admin-pane.tsx:138` is removed
- [ ] No hardcoded model IDs appear outside `model-discovery.ts`
- [ ] `pnpm verify:foundation` green
