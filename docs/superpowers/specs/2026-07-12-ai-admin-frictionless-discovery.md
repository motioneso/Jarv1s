# AI admin — frictionless model discovery (epic #869 follow-on)

**Status:** Draft (awaiting Ben's approval)
**Date:** 2026-07-12
**Grounded on:** `origin/main` @ `a3b2b98bfb4b20d2118371d794f65c737f31bcb8` (verified via detached
read-only worktree; the coordination worktree was 63 commits behind and was not used for grounding).
**Tier:** Lane A security · Lane B routine (see Slicing)
**Builds on:** Slice 1 of epic #869 (task #870, PR #876, merged `ce3892fc`) — spec
`docs/superpowers/specs/2026-07-08-assistant-ai-admin-slice1.md`; Voice/STT split (#874, PR #886);
`#367` auto-register (`packages/ai/src/auto-register.ts`); module service bindings (#915 D6,
`packages/ai/src/capability-route-routes.ts`). Prior discovery specs
(`2026-06-22-ai-model-discovery.md`, `2026-06-18-ai-provider-test-and-model-detect.md`,
`2026-06-20-auto-register-chat-model-on-login.md`) are fully superseded on the UX surface by this
document; their backend services (`ModelDiscoveryService`, provider test, auto-register) are reused
unchanged except where noted.

## Problem

Ben, verbatim intent: _"I don't want an add model at all... I haven't seen that ANYWHERE else in an
AI tool. Auto discover should be AUTO, the user doesn't need to take so many steps to get it
working."_

Target end-state: **add a provider credential (or sign in to a CLI provider) → the system
auto-discovers its models, infers capabilities + tier, activates them, and auto-picks a sensible
default model per service — with zero further manual steps.** No "Add model" form, no "Discover"
button.

Today's reality — and this matters because **all of Ben's providers are CLI-auth** (Claude + Codex
subscriptions, no API key):

1. **CLI providers still require manual model enablement.** #870 shipped auto-discovery-on-connect,
   but only API-key providers get live-discovered models inserted `active`. For CLI providers the
   curated static list is deliberately inserted **`disabled` / pin-only**
   (`packages/ai/src/routes.ts:198-206`, `insertStatus = isCli ? "disabled" : "active"`; rationale
   comment `packages/ai/src/model-discovery.ts:34-38`, "#870/H5"). The admin pane shows them as
   "off" rows the admin must individually enable.
2. **The manual "Add model" form survives**, defaulting capabilities to `["chat"]` with a checkbox
   grid the user must hand-tick (`apps/web/src/settings/settings-ai-admin-pane.tsx:157-251`,
   default at `:163`). This is the exact wart Ben described.
3. **The manual "Discover" button + checkbox picker survive**
   (`settings-ai-admin-pane.tsx:485-493` button, `:522-581` picker, `:494-497` "Add" toggle). The
   empty state literally instructs manual work: _"No models registered yet — add one to bring this
   provider online"_ (`:517-519`).
4. **Discovery fires only on the admin `POST /api/ai/providers` route.** It does NOT fire on the
   #367 login-ready path (`auto-register.ts` creates the provider + sentinel only — no discovery
   call anywhere in the file), and it does NOT re-fire when an admin fixes a bad API key
   (`PATCH /api/ai/providers/:id` only invalidates the cache, `routes.ts:267` — the admin must then
   press "Discover" by hand).
5. **The failure path is hostile (#981).** Ben bound News's json work to a model on a CLI-auth
   provider; `generateStructured` decrypts the provider credential with no guard
   (`packages/ai/src/structured/generate-structured.ts:83-86`) and a throwing decrypt
   (`packages/db/src/secret-cipher.ts:175-178`, `keyId` branch — `tryKey(key)` has no try/catch)
   surfaces as a raw AES-GCM error / bare 500. Nothing prevented binding a json-requiring service
   to a provider that cannot execute json in the first place
   (`capability-route-routes.ts:120-136` validates capability + active status, but not
   `auth_method`).

## Current state — what #870/#874 already shipped (do not re-build)

Honest framing: **#870 delivered the zero-step outcome for API-key providers only. CLI/interactive
providers — the dominant case on Ben's instance — still require manual enable + manual capability
ticking. This slice closes that gap.**

Already shipped and reused as-is:

- `ModelDiscoveryService.discoverModels` — live `GET /models` for anthropic/google/openai-compat,
  1h cache, static fallback, `inferModel` capability + tier inference
  (`packages/ai/src/model-discovery.ts`).
- Discovery-on-create for the admin route, API-key models inserted `active`
  (`routes.ts:174-210`).
- Auto instance-default when the sole active admin provider is created via the admin route
  (`routes.ts:212-223`, #870/H1).
- `upsertDiscoveredModels` — INSERT-only, `onConflict … doNothing`; never resurrects a disabled
  model, never clobbers admin edits (`packages/ai/src/repository.ts:531-577`).
- The #367 sentinel: one active `"default"` chat model per CLI provider that rides the CLI's
  account model (`auto-register.ts:27,54-78`).
- Resolution machinery: `resolveModelForCapability` (admin pin → service binding → instance-default
  provider ladder → needs-config, `repository.ts:1018-1141`), `resolveModelForService` (#915 D6,
  `repository.ts:1149-1197`), cross-provider worker selection
  (`selectAutomaticModelForCapability`, `repository.ts:1278-1313`).
- Voice/STT as a dedicated endpoint, out of discovery entirely (#874).

## Goals

1. A CLI provider is fully usable the moment it connects: static models land **active** with
   inferred capabilities + tier; chat keeps riding the #367 sentinel; nothing to enable, tick, or
   discover by hand.
2. Discovery fires **automatically on every connect-shaped event** (admin create, credential/auth
   change, CLI login-ready) and lazily self-heals — never behind a button.
3. Delete the manual surfaces: `AddModelForm`, the "Discover" button, the discovered-models
   checkbox picker, and the "add one to bring this provider online" empty state.
4. Per-service defaults resolve automatically from whatever is connected; a service that
   **cannot** be served (json on a CLI-only instance) shows an actionable needs-config state, never
   a raw 500.
5. Bindings that can never work are rejected at write time with an actionable message (#981
   prevention), and the credential-decrypt path can no longer leak a raw AES-GCM error (#981
   ride-along, ai-package half).

## Non-goals / Guardrails

- **No execution-transport change.** Chat stays on the CLI bridge (M-A3); structured json stays
  direct-HTTP (`HttpApiAdapter`). Making CLI providers execute structured json is a separate epic.
- **No new admin knobs.** This slice only removes surface. No per-service binding UI is added;
  automatic resolution (not persisted bindings) delivers "sensible default per service".
- **Voice untouched** (#874 dedicated endpoint; discovery never emits `transcription`).
- **Natural-language control is Slice 2** of #869 — not here.
- **No gemini CLI entry, no `/model` TTY enumeration** (non-blocking spike per #869).
- **Provider-agnostic invariant holds:** the only hardcoded model ids remain the static lists in
  `model-discovery.ts` (`ANTHROPIC_STATIC_MODELS`, `CLI_STATIC_MODELS`) and the data map in
  `auto-register.ts`. No new code path names a provider or model.
- **No SQL data migration.** `ai_configured_models` and friends are FORCE RLS; the migration role
  sees zero rows (Slice-1 finding C1). All reconciliation is lazy app-code. No new DDL is needed at
  all — this slice is code-only.

## Resolved design decisions

### D1 — CLI-discovered statics become active-by-default; the sentinel keeps chat precedence

- Flip `routes.ts:201` to insert discovered models `"active"` for CLI providers too (the
  `shouldPersist` split at `:199` stays: API-provider fallback lists are still never persisted).
- **This deliberately reverses Slice-1 decision H5** ("statics inactive so they never out-rank the
  sentinel"). H5's hazard was real, so it is re-solved at the resolver instead of by keeping models
  dark: in `selectModelInProviderForCapability` (`repository.ts:1214-1227` tier loop and
  `:1231-1239` fallback), order the sentinel first — an
  `ORDER BY (models.provider_model_id = '<DEFAULT_MODEL_SENTINEL>') DESC` term ahead of the
  existing `created_at desc`. Result: an unbound/mode-bound **chat** resolution inside a CLI provider always
  picks the sentinel (rides the account model, never stale, no `--model` passed); concrete statics
  win only via an explicit pin — exactly the #367 contract.
- Statics keep their full inferred capability sets (json/tool-use/vision/summarization). They do
  **not** contaminate worker routing because of D3. Rationale for keeping the caps rather than
  stripping to `["chat"]`: when a CLI structured-execution path lands later, the rows are already
  correctly tagged; and capability display in the admin pane stays truthful to what the model can
  do, while D3 encodes what the **provider connection** can execute.
- Staleness: static ids live in exactly one data file (`model-discovery.ts:13-46`); refreshing them
  is a one-file data edit, same as today.
- Codex note: `CLI_STATIC_MODELS` intentionally has no `openai-compatible` entry
  (`model-discovery.ts:40-41` — codex has no concrete shipped ids). A Codex CLI provider therefore
  remains sentinel-only. That is correct, not a gap: the sentinel IS the working chat model.

### D2 — discovery fires on every connect event; the buttons die

- **(a) Admin create** — already shipped (`routes.ts:188-210`). Unchanged apart from D1.
- **(b) Credential / auth change** — `PATCH /api/ai/providers/:id` currently only invalidates the
  discovery cache (`routes.ts:267`). After a successful update that changes `credentialPayload`,
  `baseUrl`, or `authMethod`, re-run the same best-effort discover + `upsertDiscoveredModels` block
  as create (extract the create-route block into a shared helper, e.g.
  `discoverAndPersistModels(scopedDb, provider, credentialInput)` in `packages/ai/src/routes.ts` or
  a small module). Fixing a bad API key now yields models on save, zero extra steps.
- **(c) CLI login-ready (#367 path)** — `AiAutoRegisterService.ensureDefaultChatModel`
  (`auto-register.ts:110-142`) additionally invokes the same helper after ensuring the
  provider + sentinel, so a provider born from CLI login (the path that creates Ben's providers)
  gets its statics without the admin route ever being called. Inject `ModelDiscoveryService` as a
  constructor dep; keep the call best-effort (discovery failure never fails login-ready). The
  existing `hasChatModelForProviderKind` early-return must NOT skip discovery — restructure so the
  sentinel gate only guards sentinel creation, and discovery/upsert always runs (it is idempotent
  via `onConflict doNothing`).
- **(d) Lazy self-heal** — when the admin models/providers list is served
  (`GET /api/ai/providers` / models list in `routes.ts`) and an **active** provider has zero
  configured models, fire the same best-effort helper server-side before responding (bounded by
  the existing 1h `ModelDiscoveryService` cache, so this cannot become a hot loop). This heals
  "provider created while the network was down" without any button.
- **UI deletions** (`settings-ai-admin-pane.tsx`): `AddModelForm` (`:157-251`), the "Discover"
  button + `discoverMutation` + `discovered`/`selectedIds` state + checkbox picker
  (`:277-278, :290-321, :485-493, :522-581`), the "Add" toggle (`:494-497`, `addOpen`), and the
  manual empty-state copy (`:517-519` → replaced per UX section). `EditModelForm`, the disable
  toggle, and the user-override switch remain as tucked-away escape hatches (tier-correct /
  capability-correct / disable — per #870's design).
- The REST endpoints stay: `POST /api/ai/models` (used by tests and by Slice-2 NL control as an
  escape hatch) and `POST /api/ai/providers/:id/models/discover`
  (`provider-validation-routes.ts:95`) — the latter becomes an internal/self-heal + Slice-2 surface
  with no UI caller. Deleting them is pure churn with no UX payoff; the spec explicitly keeps them.

### D3 — execution-transport-aware resolution: json never resolves to a CLI provider

Structured json executes over direct HTTP with an API key (`generate-structured.ts:101-105`);
a CLI provider's credential is the sealed `{ cli: true }` marker (`auto-register.ts:128-132`) —
it can never serve it. Encode that at resolution and at binding write:

- Add a single predicate, e.g. `capabilityRequiresApiExecution(capability)` returning `true` for
  `"json"` (data-driven set in `packages/ai/src`, extensible; NOT provider-specific — it describes
  the transport, preserving provider-agnosticism).
- Where the predicate holds, model-selection queries add
  `.where("providers.auth_method", "=", "api_key")`:
  `selectAutomaticModelForCapability` (`repository.ts:1278`), `selectModelInProviderForCapability`
  (`repository.ts:1204`, covers the admin-pin-provider branch), the pinned-model query
  (`repository.ts:1037-1044`), the service-binding model queries (`repository.ts:1116-1123` and
  `:1174-1180`). Misses flow into the existing `logNeedsConfig` observability (`repository.ts:1258`).
- `PUT /api/ai/services/:service/binding` validation (`capability-route-routes.ts:120-136`): when
  `requiredCapability` requires API execution, also require the model's provider
  `auth_method === "api_key"`; otherwise reject 400 with actionable copy:
  `"this model's provider signs in via CLI and has no API credential for json generation — pick a model on an API-key provider"`.
- Net effect on Ben's instance: with only CLI providers, News json resolves `needs_config`
  (observable, actionable) instead of a raw 500; the moment any API-key provider is added, worker
  json starts flowing to it automatically with zero binding writes.

### D4 — credential decrypt can never surface a raw AES-GCM error

- Wrap `deps.cipher.decryptJson(provider.encrypted_credential)` in
  `generate-structured.ts:83-85` in try/catch: on throw, `logger.warn` an internal summary (no
  secret material, no ciphertext) and return `{ ok: false, error: "needs_config" }` — the same
  contract callers already handle. `secret-cipher.ts` itself is untouched (its throw-on-corruption
  behavior is correct for other callers, #114).
- Sweep the ai package for other unguarded `decryptJson` calls on runtime request paths and apply
  the same guard (discovery's create-path already soft-fails via its outer try, `routes.ts:208`).
- The News-side user-facing 503 copy ("News needs an AI model…") remains issue #981's own scope in
  `packages/news`; this spec delivers the ai-package half #981 depends on (stable `needs_config`
  instead of an exploding 500).

### D5 — instance default and per-service defaults are automatic on every creation path

- The sole-active-provider auto-default rule (`routes.ts:212-223`) currently runs only in the admin
  create route. Apply the same rule in the auto-register path (inside the shared helper or after
  provider creation in `ensureDefaultChatModel`) so a CLI-login-first instance — the founder path —
  has an instance default without ever opening settings.
- "Auto-pick a sensible default model per service" is delivered by **resolution, not persisted
  bindings**: unbound chat already walks the instance-default provider's ladder
  (`repository.ts:1127-1140`, sentinel-first per D1); unbound worker/module json picks
  cross-provider automatically (`repository.ts:1105-1111`, api_key-filtered per D3). No writes
  means no competing defaults, nothing to migrate, and adding/removing providers self-adjusts.

### D6 — existing-install reconcile (lazy, no SQL)

Ben's live instance already has CLI statics sitting `disabled` from #870. `upsertDiscoveredModels`
is `doNothing`-on-conflict, so D1 alone won't heal them. During the D2 helper's upsert step, for
CLI providers only: flip rows to `active` where `status = 'disabled'` AND
`updated_at = created_at` (never touched since system insert) AND the row's `provider_model_id`
is in the current static list. Any admin edit (including an explicit disable) goes through
`updateModel`, which bumps `updated_at` — so genuinely admin-disabled models are never resurrected,
preserving #870's "never resurrect" rule. Covered by an integration test either way.

## UX walkthrough — before / after

**CLI provider (Ben's case).**
Before: sign in via Claude CLI → chat works (sentinel), but the provider card shows three "off"
model rows; News topic-add → _"Topic checking is unavailable right now"_ (a lie — it's a config
gap) or a raw 500; the "fix" is: enable a model → open Edit → tick json/economy checkboxes → bind →
raw AES-GCM 500 anyway, because the provider has no API credential.
After: sign in via Claude CLI → provider card appears with the sentinel ("Claude — default model")
plus the statics, all active, capabilities + tiers inferred, read-only. Chat behavior unchanged
(sentinel). News json shows one honest, actionable state: _"needs an API-key provider"_ — and the
moment an API key is added to any provider, it starts working with zero clicks. No Add. No
Discover. No checkboxes.

**API-key provider.**
Before: create with key → models appear active (shipped) — but a typo'd key meant an empty
provider and a manual "Discover" after fixing it.
After: fixing the key on Save re-discovers automatically; an empty provider self-heals on the next
settings visit. The buttons are gone.

**Empty state copy** (replaces `:517-519`): reflects reality instead of assigning homework — e.g.
_"Models appear here automatically when the provider connects."_ (plus, for an API provider with a
failed probe, the existing soft "couldn't reach the provider's model list — check the key" note).

## Slicing

**Lane A — backend (packages/ai): discovery triggers, activation, transport filter, error guard.**
D1 + D2(a-d server side) + D3 + D4 + D5 + D6. One shared `discoverAndPersistModels` helper; resolver
query changes; binding-write validation; decrypt guard; reconcile. Integration tests per acceptance
criteria. **Tier: security** — this changes which backend receives private prompts (routing) and
touches the credential-decrypt path; independent security-lens review before merge per project
rules. Estimated: ~1 agent build day.

**Lane B — frontend (apps/web): delete the manual surfaces.**
UI deletions + empty-state copy + (if any json-capable model picker exists in service/binding UI)
filter to API-provider models. Net-negative diff (~250 lines removed from
`settings-ai-admin-pane.tsx`). Depends on Lane A being merged (so the empty state is truthful).
**Tier: routine.** Estimated: ~half agent day. Frontend-only QA gate (no PG suite) per
multi-agent-contention rule.

## Acceptance criteria

1. `packages/ai/src/routes.ts` create route inserts CLI-discovered models with `status: "active"`
   (today `:201` inserts `"disabled"`); API-provider fallback lists are still never persisted
   (`shouldPersist` logic at `:199` preserved). Integration test: create CLI provider → statics
   active.
2. With a CLI provider holding the sentinel + active statics, `resolveModelForCapability("chat")`
   (unbound and mode-bound) returns the sentinel row, not a concrete static — test against
   `selectModelInProviderForCapability` ordering. Explicitly pinning a static still returns the
   static.
3. `PATCH /api/ai/providers/:id` with a changed credential triggers discovery: test with a fake
   fetch — provider created with bad key has zero models; PATCH with good key → models active, no
   other call needed.
4. CLI login-ready path (`AiAutoRegisterService.ensureDefaultChatModel`) results in sentinel +
   active statics + instance-default flag (when it's the sole active provider) — extend the
   existing auto-register integration tests; re-login remains idempotent (no duplicates, no
   resurrection of admin-disabled rows).
5. `resolveModelForService(scopedDb, "module.news", { capability: "json" })` on an instance with
   only CLI providers returns `{ model: null, reason: "needs-config" }` and logs to
   `jarvis_error_log` — never selects a CLI-provider model, even one tagged `json`. With an
   additional API-key provider, it selects that provider's model automatically with no binding
   rows.
6. `PUT /api/ai/services/module.news/binding` with a model on a CLI-auth provider returns 400 with
   copy naming the cause + fix (test asserts the message mentions the missing API credential).
7. `generateStructured` with an undecryptable provider credential (wrong-key envelope fixture)
   returns `{ ok: false, error: "needs_config" }` and logs a warning — the AES-GCM error string
   never reaches the result or an HTTP response (regression test for #981's raw-500).
8. `apps/web/src/settings/settings-ai-admin-pane.tsx` contains no `AddModelForm`, no
   `discoverMutation`/discover button, no discovered-models checkbox picker, no "add one to bring
   this provider online" copy; `EditModelForm`, disable toggle, and override switch remain.
   Existing pane e2e/screens updated.
9. Existing-install reconcile: a fixture with #870-era `disabled` CLI statics
   (`updated_at = created_at`) flips to active on the next discovery pass; a row disabled via
   `updateModel` (bumped `updated_at`) stays disabled.
10. No new migration files; full gate green (`pnpm verify:foundation`), including the unchanged
    `foundation.test.ts` migration list.

## Open questions for Ben

1. **Reconcile heuristic (D6):** auto-activating the #870-era disabled statics on your existing
   install relies on "never edited ⇒ system state". If you ever hand-disabled one of those three
   Claude rows through Edit, it stays off (correct); if you hand-disabled it some way that didn't
   bump `updated_at`, it would come back on. Acceptable?
2. **Keep the hidden REST escape hatches?** The spec keeps `POST /api/ai/models` +
   `POST …/models/discover` endpoints (no UI) for tests and Slice-2 NL control. If you want "no add
   model" to mean the API too, say so and Lane A deletes them.
3. **CLI-only instance + json services:** with no API key anywhere, News/json stays an honest
   needs-config forever. Is a follow-up spike on structured-json-over-the-CLI-bridge worth filing
   (separate epic per the transport guardrail), or is "add one API key for background json work"
   the intended steady state?
4. **Codex stays sentinel-only** (no concrete static ids exist to list). Fine, or do you want a
   minimal curated codex list added to `CLI_STATIC_MODELS` as data?
