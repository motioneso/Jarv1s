# Tier-based model auto-discovery & per-capability selection

**Status:** Approved design — ready to build
**Date:** 2026-06-22
**Owner:** Ben
**GitHub:** #375; supersedes minimum-viable scope of #253
**Grounded on:** `origin/main` @ `15448ba` (current branch `docs/update-stale-documentation`,
docs-only ahead, source tree unchanged).
**Depends on:** #423 (model discovery must ship first — tier heuristic plugs into discovery
checklist).

---

## Goal

Remove the "coming soon" stub from the capability router section in Settings: let users
see and change which tier each capability uses, and have those preferences actually govern
which model the router picks. The auto-tier heuristic assigns sensible defaults silently
during model discovery; users override per-capability in Settings.

Success = in Settings on the deployed instance: the tier selector next to each capability
row is interactive; changing it persists and immediately governs which model Jarvis picks
for that capability; `pnpm verify:foundation` green.

---

## Design decisions (interview-confirmed)

| #   | Decision                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Auto-tier heuristic runs **silently** during discovery (#423 flow); user can override the inferred tier in the discovery checklist before saving                          |
| D2  | Per-capability tier preference stored in `app.preferences` (table already exists, no migration)                                                                           |
| D3  | `selectModelForCapability` reads actor's tier preference before falling back to the default `"interactive"` tier                                                          |
| D4  | `RouterRow` changes from a model picker to a **tier selector**; shows resolved model name as read-only info                                                               |
| D5  | #375 supersedes the minimum-viable scope of #253 (capability routing) for the single-owner case; #253 as an instance-wide admin default remains a separate future concern |

---

## Architecture

### 1. Auto-tier heuristic (`packages/ai/src/model-discovery.ts`)

Added in the same file as the #423 discovery service. A pure function with no I/O:

```typescript
export function inferTierFromModelId(providerKind: AiProviderKind, modelId: string): AiModelTier {
  const id = modelId.toLowerCase();
  if (providerKind === "anthropic") {
    if (id.includes("opus")) return "reasoning";
    if (id.includes("sonnet")) return "interactive";
    if (id.includes("haiku")) return "economy";
    return "interactive"; // unknown future models default to interactive
  }
  if (providerKind === "openai-compatible") {
    // o-series: reasoning models
    if (/\bo[0-9]/.test(id)) return "reasoning";
    // mini / nano / small variants: economy
    if (id.includes("mini") || id.includes("nano") || id.includes("small")) return "economy";
    // gpt-3.5 family: economy
    if (id.includes("3.5") || id.includes("3-5")) return "economy";
    return "interactive";
  }
  return "interactive";
}
```

Called in the discovery checklist (from #423's `DiscoveredModel` shape): each discovered
model is annotated with an `inferredTier` field shown as the pre-selected tier in the
checklist. The user can change it before "Add selected".

### 2. Per-capability tier preference storage

Key format in `app.preferences`:

```
ai.capability_tier.{capability}
```

where `{capability}` is one of: `chat`, `tool-use`, `json`, `vision`, `summarization`.

Value JSON: a string literal — `"reasoning"`, `"interactive"`, or `"economy"`.

No migration required — `app.preferences` already exists (migration `0031`),
has owner-only RLS, and is granted to `jarvis_app_runtime` and `jarvis_worker_runtime`.

### 3. Updated `selectModelForCapability` (`packages/ai/src/repository.ts`)

Current signature:

```typescript
export async function selectModelForCapability(
  scopedDb: DataContextDb,
  capability: AiModelCapability,
  tier: AiModelTier = "interactive"
): Promise<AiConfiguredModelRow | null>;
```

Updated behaviour: when called with a `scopedDb` that carries an actor context, read the
actor's `ai.capability_tier.{capability}` preference from `app.preferences` first. Use it
as the effective tier if present; fall back to the `tier` parameter otherwise. The tier
ladder walk (economy → interactive → reasoning) is unchanged.

Implementation — add a helper inside the repository module (not exported):

```typescript
async function readCapabilityTierPreference(
  scopedDb: DataContextDb,
  capability: AiModelCapability
): Promise<AiModelTier | null> {
  const row = await scopedDb
    .selectFrom("app.preferences")
    .select("value_json")
    .where("key", "=", `ai.capability_tier.${capability}`)
    .executeTakeFirst();
  const v = row?.value_json;
  if (v === "reasoning" || v === "interactive" || v === "economy") return v;
  return null;
}
```

`selectModelForCapability` calls this before its existing ladder logic. The caller-supplied
`tier` parameter becomes the fallback, preserving all existing callers without changes.

### 4. New API endpoints (AI module routes + `ai` module manifest)

#### `GET /api/ai/capability-tier-preferences`

Permission: `ai.view`. Returns the current actor's full tier preference map:

```typescript
{
  preferences: {
    [capability: string]: "reasoning" | "interactive" | "economy"
  }
}
```

Capabilities not yet explicitly set by the user are **absent** from the map (not defaulted
server-side — the client infers "interactive" for absent keys). This keeps the contract
minimal and avoids unnecessary preference rows.

#### `PATCH /api/ai/capability-tier-preferences`

Permission: `ai.manage`. Body:

```typescript
{
  capability: AiModelCapability;
  tier: "reasoning" | "interactive" | "economy";
}
```

Upserts a single preference row (insert on conflict update). Returns `204 No Content`.

Both routes are added to the AI module manifest (`packages/ai/src/manifest.ts`) and
implemented in `packages/ai/src/routes.ts`.

### 5. Settings UI — `RouterRow` wired (`apps/web/src/settings/settings-ai-admin-pane.tsx`)

`RouterRow` currently renders a model-ID `<Select>` with an onChange that shows a
"coming soon" toast. This spec replaces it:

#### New shape

- **Left side:** capability name + description (unchanged)
- **Right side:** a tier `<Select>` with options: Economy / Interactive / Reasoning (in that order, least to most capable)
- **Below the select:** a read-only "→ model-display-name" indicator showing which specific
  model would be selected given the current tier + the actor's configured models

#### Data flow

```typescript
// New React Query key (add alongside existing keys)
queryKeys.ai.tierPreferences  →  GET /api/ai/capability-tier-preferences

// RouterRow reads:
const tierPrefsQuery = useQuery({ queryKey: queryKeys.ai.tierPreferences, queryFn: getCapabilityTierPreferences });
const setTierMutation = useMutation({ mutationFn: patchCapabilityTierPreference, ... });

// Resolved-model indicator: derive from props.models (already available in the parent)
// — filter by capability + tier match, take first; mirrors selectModelForCapability ladder logic in JS
```

The mutation on `onChange` calls `patchCapabilityTierPreference({ capability, tier })` and
on success invalidates `queryKeys.ai.tierPreferences`.

#### `NotWired` banner removal

The `<NotWired>` wrapper around the routing section is removed when this spec lands. The
`BACKEND-TODO` comment at line 139 is updated to note that capability routing is wired
(but instance-wide admin defaults from #253 remain future work).

---

## Relationship to #253

Issue #253 ("Admin AI: persist + apply capability routing") targets instance-wide
capability → modelId routing. This spec (#375) implements per-user tier preferences, which
is a different axis:

|             | #375 (this spec)                     | #253 (future)                           |
| ----------- | ------------------------------------ | --------------------------------------- |
| Granularity | tier (economy/interactive/reasoning) | specific modelId                        |
| Scope       | per-user (`app.preferences`)         | instance-wide (`app.instance_settings`) |
| UI          | tier selector per capability         | model-ID picker per capability          |

For the current single-owner Jarvis instance these are functionally equivalent. #375 ships
first because tier-based routing is more provider-agnostic and requires no migration.
#253 can layer on top later for power-user pinning.

---

## No migration

`app.preferences` exists (migration `0031`), has owner-only RLS (`ENABLE`, `FORCE`), and
is already granted to both `jarvis_app_runtime` and `jarvis_worker_runtime` (migration
`0093`). No new tables, no new migration file needed.

---

## Out of scope

- Instance-wide admin default tier per capability (deferred to #253)
- Pinning a specific model (by ID) to a capability (deferred to #253)
- Bulk-reset preferences to defaults
- Surfacing which tier each request was resolved at in the chat UI

---

## Acceptance criteria

- [ ] `GET /api/ai/capability-tier-preferences` returns an empty map for a user with no preferences set
- [ ] `PATCH /api/ai/capability-tier-preferences` with `{ capability: "chat", tier: "reasoning" }` upserts the preference; a subsequent GET returns `{ preferences: { chat: "reasoning" } }`
- [ ] `selectModelForCapability(db, "chat")` on a scoped DB for that user now walks from "reasoning" tier downward, not "interactive"
- [ ] The capability router section in Settings shows a tier selector for each of the 5 capabilities; `onChange` persists and the selector reflects the saved value on next load
- [ ] The resolved-model indicator below each selector shows the correct model name given the current tier
- [ ] `NotWired` banner is removed from the routing section
- [ ] Auto-tier heuristic is applied to discovered models during #423 flow: an Anthropic "haiku" model gets `tier: "economy"` pre-selected in the checklist; user can change it before saving
- [ ] `inferTierFromModelId("anthropic", "claude-haiku-4-5")` → `"economy"`; `inferTierFromModelId("anthropic", "claude-opus-4-8")` → `"reasoning"`; `inferTierFromModelId("openai-compatible", "gpt-4o-mini")` → `"economy"`
- [ ] `pnpm verify:foundation` green
