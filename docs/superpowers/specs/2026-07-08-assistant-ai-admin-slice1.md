# Assistant & AI admin — Slice 1: auto-discovery on connect, per-provider instance default, unified per-service mode/model

**Status:** Draft v2 — awaiting approval (revised after Fable 5 adversarial review)
**Date:** 2026-07-08
**Owner:** Ben
**GitHub:** #870 (task) — Part of epic #869
**Grounded on:** `origin/main` @ `5f7784a7` (source tree unchanged).
**Builds on:** ADR-0008 (capability router, provider-agnostic); M-A3 (CLI-bridge execution);
`2026-06-22-ai-model-discovery.md` (#423, the discovery service this makes automatic).

> **v2 changelog** — folded in the Fable 5 review (C1, H1–H5, M1–M5, L1–L3):
> C1 no SQL data migration → lazy read-through; H1 global unique index; H2 stale-route filtering;
> H3 workers keep cross-provider automatic; H4 Voice is real in Slice 1 (transcription already
> executes over HTTP); H5 CLI sentinel precedence; M3 Embeddings dropped from the surface.

---

## Goal

Make the **Assistant & AI** admin settings self-configuring and simple. An admin adds a provider
(CLI subscription or API key); models are **auto-discovered and auto-mapped** to tiers +
capabilities — no per-model hand entry. The admin then makes only high-level choices: which
provider is the **instance default**, and per user-facing service either a **mode** (tier) or a
**specific model**. The overlapping resolution knobs that exist today collapse toward one clear
mental model.

**Success** = on the deployed instance, in Admin → Assistant & AI:

- Adding a provider auto-populates its model list (live `/models` for API-key providers; a curated
  static list for CLI-subscription providers) with tier + capabilities already assigned — no manual
  "Add model" step.
- Exactly one provider carries an **instance-default** radio (auto-selected when only one active
  admin-owned provider exists).
- The **Chat** service has one selector: pick a **mode** or a **specific model**; **Voice** likewise.
- Setting a service to a mode whose tier the default provider lacks shows a visible **needs-config**
  state — never silently borrows a model from another provider.
- Existing `ai.capability_routes` config keeps working across the upgrade (no chat outage, no config
  loss).
- Background worker AI (summarization/etc.) is unaffected.
- `pnpm verify:foundation` + full `test:integration` green.

Non-goals (explicit): natural-language control (Slice 2); changing chat execution transport (all
providers keep riding the CLI bridge — API keys are used for discovery + already-existing HTTP
transcription); driving interactive `/model` over the bridge (non-blocking spike in #869).

---

## Mental model

```
service → ( mode-reference | explicit-model-pin )
```

- **mode-reference** (tier: `reasoning | interactive | economy`) → resolves to the **instance-default
  provider's** active model of that tier.
- **explicit-model-pin** → an exact model on any provider; overrides the default provider (e.g.
  "Claude Sonnet is the chat model" even when the default provider is local Ollama).
- **Missing tier on the default provider** → walk the tier ladder **inside that provider only**
  (`economy → interactive → reasoning`); if nothing capable, surface a visible **needs-config** state
  on the service. **No silent cross-provider fallback** — surprising, and can route private data to
  an unexpected backend (security-first).

Scope of the mental model (H3): it governs the **user-facing services only** — `chat` and `voice`
(transcription). **Background worker capabilities** (`summarization`, `json`, `tool-use`, `vision`)
keep today's **cross-provider automatic** selection; they are not bound to the default provider and
are not surfaced as admin rows. This preserves briefings / memory-distillation / email-extract on a
CLI-default instance that also has a secondary API-key provider.

Terminology reuses existing columns — no parallel vocabulary:

- **mode** = `ai_configured_models.tier` (migration 0048).
- **service** = a curated subset of `ai_configured_models.capabilities` — `chat`, `transcription`.
- **provider** = `ai_provider_configs`, `auth_method` ∈ `{cli, api_key}` (0033).

⚠️ Landmine: `interactive` is **both** a tier value **and** a provider `execution_mode` value (0117).
Independent — keep distinct in code and UI copy.

---

## Design decisions (interview-confirmed + review-hardened)

| #   | Decision                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Reuse existing tables/vocabulary: mode = tier, service = capability. No new "mode/service" concepts.                                                                                                |
| D2  | Instance default = single radio across providers; **global** one-default invariant; auto-default when exactly one active admin-owned provider.                                                      |
| D3  | mode resolves **inside the default provider only**; missing tier → visible needs-config, no cross-provider fallback.                                                                                |
| D4  | explicit pin can name a model on **any** provider and overrides the default provider.                                                                                                               |
| D5  | Auto-discover **on connect**; API-key → live `/models`; CLI → curated static list per **installable+loginable** kind.                                                                               |
| D6  | Models render read-only/collapsed; tucked-away edits = **disable**, **tier-correct**, **capability-correct** (needed for Voice, H4).                                                                |
| D7  | Retire per-user tier preference (`ai.capability_tier.<cap>`) **fully** (repo + routes + DTOs + manifest). Migrate `ai.capability_routes` → per-service bindings via **lazy read-through**, not SQL. |
| D8  | Keep per-user chat override + `allow_user_override` master switch. Keep admin-per-user pin, **extended to provider-OR-model**.                                                                      |
| D9  | Services surfaced: **Chat** (primary) + **Voice** (→ transcription). **Embeddings dropped** (separate in-process M-A1 path, no capability to bind).                                                 |
| D10 | Chat execution transport unchanged (CLI bridge). Transcription already executes over HTTP today — **no fast-follow needed for Voice to function**.                                                  |
| D11 | Worker capabilities keep cross-provider automatic selection; needs-config resolutions logged to `jarvis_error_log`.                                                                                 |

---

## Data model

**Only one real DDL migration.** `service_bindings` and the admin provider-pin live in existing k/v
stores (`app.instance_settings` / `app.preferences`) written by app code — no data-migration SQL
(C1: those tables are `FORCE RLS`, `NOBYPASSRLS` migration role sees zero rows).

Migration number is **next-free-at-landing** — do **not** hardcode `0146` (claimed by in-flight
#744). New SQL file must also be appended to `packages/ai/src/manifest.ts` `database.migrations`
(M5c) **and** to `foundation.test.ts`'s full-list `toEqual`.

### `<next>_ai_provider_instance_default.sql`

- `ALTER TABLE app.ai_provider_configs ADD COLUMN is_instance_default boolean NOT NULL DEFAULT false;`
- **Global** one-default invariant (H1) — partial unique index not scoped to owner:
  `CREATE UNIQUE INDEX ai_provider_configs_one_default ON app.ai_provider_configs ((true)) WHERE is_instance_default;`
- Setting the default = one transaction: blind `UPDATE ... SET is_instance_default = false WHERE is_instance_default` then set the target. The 0091 UPDATE policy is bare `current_actor_is_admin()` (no owner check), so the blind clear reaches even rows the actor can't `SELECT` (e.g. a demoted admin's now-invisible row still holding the flag) — avoids a wedged unique slot.
- **Auto-default (D2)** is resolution-time, counted over **active admin-owned** providers only
  (`app.owner_is_active_admin(owner_user_id)` — H1): if no row is flagged and exactly one such
  provider exists, treat it as default; if >1 and none flagged → needs-config (admin must choose).
  Not "exactly one _visible_ provider" (a non-admin with a personal key sees a different count).

### `ai.service_bindings` — app-code, `app.instance_settings` (no DDL)

```jsonc
// ai.service_bindings
{
  "chat": { "kind": "mode", "tier": "interactive" },
  "transcription": { "kind": "model", "modelId": "<uuid>" } // Voice
}
```

- `kind: "mode"` → resolve via default provider; `kind: "model"` → explicit pin (any provider).
- Writes use a **single-statement merge** (M1) to avoid read-modify-write lost updates when two
  admins save different services:
  `... ON CONFLICT (key) DO UPDATE SET value = app.instance_settings.value || EXCLUDED.value`.
- Tolerant parser mirroring `parseCapabilityRouteMap` (drop unknown keys/shapes; the `kind`
  discriminator is the only versioning — no unused version field).

### Admin-per-user pin — app-code, `app.preferences` (no DDL)

- Extend from model-only to **provider-OR-model** (D8). Add `ai.admin_pinned_provider_id` alongside
  the existing `ai.admin_pinned_model_id`; widen the DTO:
  ```typescript
  interface AiAdminUserPinDto {
    readonly pinnedModelId: string | null;
    readonly pinnedProviderId: string | null; // NEW — "User X must use Gemini"
  }
  ```
- **Precedence (M4a):** at most one is set; if both are somehow present, **model pin wins** — the
  resolver defines this deterministically rather than trusting the handler-enforced invariant.

### Retire per-user tier preference — **fully** (M2)

Remove in the same pass (D7, no-stale-concepts):

- repo paths in `repository.ts` (`selectModelForCapability` tier-pref read `:461/:472`; write/list
  `:486/:509`);
- `packages/ai/src/capability-tier-preference-routes.ts` (both endpoints);
- schemas `packages/shared/src/ai-api.ts` (~`:892-921`) + DTOs `ai-types.ts` (~`:318-325`);
- manifest route registrations `manifest.ts` (~`:231-238`).
- Existing `ai.capability_tier.*` keys: no SQL delete (RLS trap, C1). Leave orphaned k/v with the
  read path gone; a labeled cleanup PR sweeps them via app code under an admin context if desired.

---

## Forward-compatibility: `capability_routes` → `service_bindings` (C1/H2 — lazy read-through, no SQL)

In `AiRepository`, when reading a service binding:

1. If `ai.service_bindings[service]` exists → use it.
2. Else if a legacy `ai.capability_routes[service]` entry exists **and** its model is currently
   **active under an active provider** → treat as `{ kind: "model", modelId }` (H2: stale/disabled
   or `null` routes are ignored, not converted — they must not manufacture a needs-config chat
   outage on upgrade; log ignored stale routes once).
3. Else → unbound (auto/needs-config per the resolver rules).

First admin save writes through to `ai.service_bindings`. `capability_routes` is never written again
(the PUT route in `capability-route-routes.ts` is removed/redirected to write bindings — M2, no dead
writes to a retired key). No release reads _and_ writes both keys.

---

## Resolver (`packages/ai/src/repository.ts`)

Rework `resolveModelForCapability` (currently `:565`). Behavior splits by capability class:

**User-facing services (`chat`, `transcription`):**

1. **Admin-per-user pin** (M4):
   - `pinnedModelId` set → that exact model if active+capable (preserve the existing **chat**
     hard-lock at `:584-587`: set-but-unavailable → `admin-pin-unavailable`, no fallthrough).
   - `pinnedProviderId` set → resolve the service's tier **inside that provider** (D3 ladder). An
     unavailable/ revoked pinned _provider_ is **also a chat hard-lock** (M4b) — symmetric with the
     model pin.
2. **Per-service binding** (`ai.service_bindings[service]`, incl. the legacy read-through above):
   - `kind: "model"` → that exact model (active+capable) else needs-config.
   - `kind: "mode"` → the **default provider's** model of `tier` (ladder inside that provider) else
     needs-config.
3. Unbound → **default-provider-scoped** automatic (existing `selectAutomaticModelForCapability`,
   tier ladder), then needs-config.

**Worker capabilities (`summarization`, `json`, `tool-use`, `vision`) — H3/D11:** unchanged —
**cross-provider** `selectAutomaticModelForCapability`. Not bound to the default provider, no
admin-pin/binding lookup. When one resolves to needs-config, log to `jarvis_error_log` (0145) so a
CLI-default instance's silently-skipped distillation/briefings are observable.

`getChatModelOverrideSettings` (`:678`) must zero out the user override when **either** an admin
model pin **or** an admin provider pin is set (M4c) — today it branches only on
`adminPinnedModelId`.

`AiCapabilityRouteReason` gains `needs-config` (or reuse `no-active-model`) for the visible error
state. The "auto-default when single admin-owned provider" rule lives here (H1 counting).

---

## Auto-discovery on connect

- On provider **create** (and an explicit **refresh** button), call the existing
  `ModelDiscoveryService` and **upsert** discovered models with inferred tier + capabilities. This
  replaces the manual "Discover → check → Add selected" flow as the default path; the manual
  `AddModelForm` leaves the happy path.
- **Idempotency (L1):** upsert on the existing `UNIQUE (owner_user_id, provider_config_id,
provider_model_id)` (0013) as insert-or-skip; **never resurrect a model an admin disabled**
  (respect status; auto-register invariant b).
- **API-key providers** (`anthropic`/`google`/`openai-compatible`) → live `GET /models` (exists).
  Teach `inferModel` (`model-discovery.ts:188`) to emit **`transcription`** for known
  transcription-capable ids (H4) so a Voice binding has a target; otherwise capability-correct (D6)
  is the manual escape hatch.
- **CLI-subscription providers** → curated **static list per installable+loginable kind** (L2: gate
  the map — gemini/google CLI is blocked in the cli-runner catalog per `auto-register.ts:75`, so no
  gemini static list). Replace the current empty CLI early-return in `fetchModels`
  (`model-discovery.ts:87`) — do not augment it (L3).
- **Sentinel precedence (H5):** for CLI kinds a `mode` binding resolves to the `auto-register`
  `"default"` sentinel when present (rides the account model, never `--model`, never stale). Static
  models are inserted **inactive / as explicit-pin choices only**, never auto-`active`, so they can't
  out-rank the sentinel in the `created_at desc` tier scan (`:637`).
- Discovery **never blocks** provider setup; on failure fall back to static/sentinel with a soft
  "couldn't auto-detect — using defaults" note. Keep the 1h in-process cache.

---

## UI (`apps/web/src/settings/settings-ai-admin-pane.tsx`, 895 lines — split if the rework crosses 1000)

- **Providers** group: each `ProviderCard` gains the **instance-default radio** (mutually exclusive;
  hidden/auto when only one active admin-owned provider). Models render **read-only / collapsed**;
  edits behind a small affordance = **disable**, **tier-correct**, **capability-correct**. Remove the
  manual `AddModelForm` from the primary path and the stale "auto-detect coming / until auto-detect
  lands" copy (~`:198/:770/:863-865`).
- **Services** group replaces the per-capability `RouterRow` list with exactly two rows:
  - **Chat** — one selector: **mode** (tier) or **specific model**; renders the resolved model id or
    the **needs-config** state.
  - **Voice** (→ `transcription`) — same selector shape. Functional in Slice 1 (transcription runs
    over HTTP today); no "coming" badge.
  - Worker capabilities (summarization/json/tool-use/vision) are **not** shown.
  - **Embeddings is not shown** (M3).
- **Admin-per-user pin** UI (`settings-admin-panes.tsx`) gains a provider option beside model
  ("User X must use Gemini").
- Keep the surface **small** — this task consolidates knobs, it does not stack a new one on top.

Shared types (`ai-types.ts`, mirrored in `packages/db/src/types.ts`): add
`is_instance_default`/`isInstanceDefault`; add
`AiServiceBinding = { kind: "mode"; tier } | { kind: "model"; modelId }` + the `ai.service_bindings`
map; widen `AiAdminUserPinDto` with `pinnedProviderId`. Delete the retired tier-pref DTOs (M2).

---

## Migration & test invariants

- The one new SQL file is appended to `foundation.test.ts`'s full-list `toEqual` **and**
  `manifest.ts` `database.migrations` (M5c — a missed manifest entry means it never runs); run full
  `test:integration` (a focused module test won't catch a missing full-list row).
- **Legacy read-through** covered by integration tests: (a) legacy route → active model resolves;
  (b) legacy route → disabled model is ignored, chat still resolves via auto/sentinel (H2, the
  no-outage guarantee); (c) first save writes `service_bindings` and stops consulting the legacy key.
- Resolver coverage: mode-inside-default-provider; missing-tier needs-config; explicit pin overriding
  default; single admin-owned provider auto-default; two admin-owned providers, none flagged →
  needs-config; admin provider-pin (available + revoked hard-lock); worker capability stays
  cross-provider on a CLI-default instance.
- Concurrency: two admins saving different services → single-statement merge preserves both (M1).

---

## Rollout / boundaries

- **Chat execution transport untouched** (CLI bridge). API keys used for discovery; transcription
  already uses direct HTTP.
- **No Voice fast-follow** — the earlier "Voice needs direct-API execution" premise was wrong
  (transcription executes over HTTP today). Voice ships functional in Slice 1.
- Per-user tier prefs + `capability_routes` writing retired in-pass; orphaned k/v keys swept by a
  labeled cleanup PR (app-context, not RLS-blocked SQL).

## Gate

Approved spec (this doc) before implementation. Full local gate
(lint + format:check + check:file-size + typecheck + relevant integration) green before PR; main CI
green before merge.
