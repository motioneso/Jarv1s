# AI admin — frictionless model discovery (epic #869 follow-on)

**Status:** Draft (awaiting Ben's approval)
**Date:** 2026-07-12
**Grounded on:** `origin/main` @ `a3b2b98bfb4b20d2118371d794f65c737f31bcb8` (verified via detached
read-only worktree; the coordination worktree was 63 commits behind and was not used for grounding).
**Tier:** Lane A security · Lane B routine · Lane C security/high-risk (see Slicing)
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
5. **json/economy work does not run on a CLI-only instance, and fails ugly (#981).** News binds
   its json work to `module.news`; `generateStructured`
   (`packages/ai/src/structured/generate-structured.ts:62-171`) resolves a model, then hard-wires
   the **direct-API** `HttpApiAdapter` (`:101-105`) and decrypts an API credential
   (`:83-85`). A CLI provider carries only the sealed `{ cli: true }` marker (no API key), so the
   decrypt throws; the throw is unguarded here and in `secret-cipher.ts:175-178` (`keyId` branch,
   `tryKey(key)` has no try/catch) → a raw AES-GCM error surfaces as a bare 500. The real gap:
   **there is no CLI-bridge execution path for `generateStructured`/`generateJson` at all** — even
   though chat already executes structured turns over the CLI (tmux/herdr) engine every day. Ben:
   _"Yes it [CLI] can [run json]... why would you think CLI couldn't run? It just runs through tmux
   or herdr."_ The fix is to **route json through the CLI bridge for CLI providers**, not to block
   json to API-key providers.

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
4. **json/economy work runs on a CLI-only instance with zero API keys** — News topic validation,
   ranking, and other structured work execute over the CLI bridge for CLI providers, the same way
   chat already does. #981 becomes "route, don't block".
5. Codex/OpenAI CLI providers get auto-discovered models too (not sentinel-only), from a concrete
   static source, so the provider card is populated the moment Codex connects.
6. The credential-decrypt path can no longer leak a raw AES-GCM error (defense-in-depth; the
   primary #981 fix is routing, this is the belt-and-suspenders for a genuinely corrupt API key).

## Non-goals / Guardrails

- **API-key structured execution is unchanged.** When a provider has an API key, json keeps
  running over `HttpApiAdapter` direct-HTTP. This slice ADDS a CLI-bridge execution path for
  CLI providers; it does not remove or alter the API path.
- **No new admin knobs.** This slice only removes surface. No per-service binding UI is added;
  automatic resolution (not persisted bindings) delivers "sensible default per service".
- **Voice untouched** (#874 dedicated endpoint; discovery never emits `transcription`).
- **Natural-language control is Slice 2** of #869 — not here.
- **No gemini CLI entry** (blocked + not loginable in the cli-runner catalog). **No `/model` TTY
  picker enumeration** — Codex models come from a curated static source (D7), not from scraping the
  interactive picker (which is itself buggy/incomplete — it omits the gpt-5.6 ids, confirmed on
  Codex CLI v0.143.0). This matches #869's non-blocking-spike stance on `/model`.
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
- Statics keep their full inferred capability sets (json/tool-use/vision/summarization) — and those
  caps are now **real**, because D3 makes CLI providers execute json over the bridge. A static
  `claude-opus` row tagged `json` genuinely serves json work.
- Staleness: static ids live in exactly one data file (`model-discovery.ts:13-46`); refreshing them
  is a one-file data edit, same as today. D7 adds the Codex/openai-compatible entry.

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

### D3 — route json through the CLI bridge for CLI providers (the real #981 fix)

**Investigation result (grounded):**

- `generateStructured` today hard-wires the direct-API adapter: it decrypts an API credential
  (`generate-structured.ts:83-85`) and constructs `HttpApiAdapter` (`:101-105`). **There is no
  CLI-execution path for `generate*` today** — this is net-new work.
- But it is NOT greenfield. The retry/parse loop is already **adapter-agnostic**: the loop
  (`generate-structured.ts:113-168`) only calls `adapter.generateStructured(input)` and works on
  the returned `rawObject`/`rawText` (`http-api-structured.ts:24-30`) — it validates against the
  schema (Ajv, `:107-108,152`) and reprompts on invalid output (`:129-138,166-167`). That IS
  "prompt for json + parse with a retry"; a CLI adapter only needs to return `rawText`.
- The one-shot CLI execution machinery **already exists and is proven daily by chat**:
  `ClaudePrintChatEngine` (claude `--print`, `packages/chat/src/live/claude-print-chat-engine.ts`)
  and `CodexExecSession` (`codex exec --json`, `packages/chat/src/live/codex-exec-session.ts:96-100`)
  launch a non-interactive one-shot, submit a prompt, and read the assistant's final text from the
  parsed transcript. Both ride the `DEFAULT_MODEL_SENTINEL` (no stale `--model`).
- The low-level primitives those engines use — the multiplexer (`TmuxMultiplexer`/herdr),
  `parseTranscript`, `transcriptGlobDir`, `redactSecrets`, `DEFAULT_MODEL_SENTINEL` — **live in and
  are exported from `packages/ai`** (`packages/ai/src/index.ts:24-27`; the chat engines import them
  from `@jarv1s/ai`). So the port belongs in `ai` and the transport is already ai-owned.

**Design — dependency-injected CLI adapter (respects module isolation):**

- The `StructuredProviderAdapter` port already exists in `ai`
  (`generate-structured.ts:28-30`) and `generateStructured` already accepts a `deps.createAdapter?`
  seam (`:39-44,101-104`).
- `generateStructured` branches on the resolved provider's `auth_method` (the row carries it,
  `repository.ts:80`, exposed via `selectProviderWithCredential`): `api_key` → existing
  `HttpApiAdapter` (decrypt + direct HTTP, unchanged); `cli` → a **CLI structured adapter** obtained
  from a new injected port (e.g. `deps.createCliStructuredAdapter(providerKind)`). For the CLI
  branch, NO credential decrypt runs (the sealed `{ cli: true }` marker has no key) — so the raw
  AES-GCM 500 disappears by construction, not by a guard.
- The CLI adapter is **implemented in `@jarv1s/chat`** (it owns the print/exec one-shot launch
  scaffolding — persona/neutral dirs, token-env sourcing, permission hooks, transcript paths) and
  **wired at the composition root** (`packages/module-registry/src/index.ts`, which already imports
  BOTH `@jarv1s/ai` line 36 and `@jarv1s/chat` line 91, and already builds the `generateJson` deps
  at `:513-524` passing only `{ repository, cipher, logger }` today). Adding `createCliStructuredAdapter`
  to those deps is a one-site wiring change. `ai` never imports `chat` (no isolation break); `ai`
  defines the port, `chat` implements it, `module-registry` injects it.
- The CLI adapter's `generateStructured(input)`: build a json-mode prompt (persona-free, schema
  embedded, "respond with ONLY a JSON object matching this schema"), run the provider's one-shot
  engine, read the assistant's final text via `parseTranscript`, return it as `rawText` with a
  best-effort token `usage` (or zeros). The existing loop handles extraction, validation, and up to
  `STRUCTURED_MAX_REPAIR_RETRIES` reprompts — no JSON parsing lives in the adapter.
- Net effect on Ben's instance: News topic validation / ranking run over the Claude (or Codex) CLI
  with zero API keys. Adding an API key later transparently switches that provider's json to the
  faster direct-HTTP path. Provider-agnostic: the branch keys on `auth_method`, never a provider
  name.

### D4 — decrypt guard (secondary defense-in-depth)

With D3, CLI providers no longer reach `decryptJson`, so the #981 raw-500 is fixed at the source.
Keep a narrow guard anyway for a genuinely corrupt **API-key** credential: wrap the decrypt in
`generate-structured.ts:83-85` in try/catch → `logger.warn` an internal summary (no secret, no
ciphertext) → return `{ ok: false, error: "needs_config" }` (a contract callers already handle).
`secret-cipher.ts` is untouched (its throw-on-corruption is correct for other callers, #114). The
News-side user-facing 503 copy rewrite stays issue #981's own `packages/news` scope; this spec
delivers the routing + guard the ai package owes it.

### D5 — instance default and per-service defaults are automatic on every creation path

- The sole-active-provider auto-default rule (`routes.ts:212-223`) currently runs only in the admin
  create route. Apply the same rule in the auto-register path (inside the shared helper or after
  provider creation in `ensureDefaultChatModel`) so a CLI-login-first instance — the founder path —
  has an instance default without ever opening settings.
- "Auto-pick a sensible default model per service" is delivered by **resolution, not persisted
  bindings**: unbound chat already walks the instance-default provider's ladder
  (`repository.ts:1127-1140`, sentinel-first per D1); unbound worker/module json picks
  cross-provider automatically (`repository.ts:1105-1111`). No writes means no competing defaults,
  nothing to migrate, and adding/removing providers self-adjusts.

### D6 — clean-slate reconcile: delete manual rows, rediscover fresh (Ben's (a) directive)

Ben: _"auto-detect the correct models fresh, and DELETE any manually-created model rows for Claude
AND Codex providers. Clean slate → only auto-detected models remain."_ No never-edited heuristic.

- In the D2 discover helper, for CLI providers (claude + codex) only, run a **replace**, not a
  merge: inside the same scoped transaction, **hard-delete every existing model row for the
  provider EXCEPT the `DEFAULT_MODEL_SENTINEL` chat model** (`auto-register.ts:27`; the sentinel is
  the chat happy-path and must survive), then insert the current static list `active`. Net result:
  the provider holds exactly the sentinel + the freshly auto-detected static models — every
  hand-added row (and every stale static from a prior list) is gone.
- This intentionally **overrides #870's "never hard-delete / never resurrect" rule for CLI
  providers**, because Ben's explicit intent is a clean slate. The kept REST `POST /api/ai/models`
  endpoint (per (b)) remains the escape hatch to re-add a model discovery genuinely missed.
- Idempotent: re-running produces the same sentinel + current static set. A one-time run on Ben's
  live instance clears the #870-era `disabled` statics and the manual rows he ticked, leaving only
  auto-detected models. Add `deleteModelsForProviderExceptSentinel(scopedDb, providerConfigId)` to
  `AiRepository`. Covered by an integration test (manual row + stale static both gone; sentinel and
  current statics present, active).
- API-key providers are NOT delete-and-replaced (their live `/models` list is authoritative and
  `upsertDiscoveredModels`' `onConflict doNothing` already keeps them correct); the clean-slate is
  a CLI-provider behavior, matching Ben's "Claude AND Codex" wording.

### D7 — Codex/OpenAI model discovery from a concrete static source (Ben's (d) directive)

Ben: _"figure out how to get codex models. Surely we can grab info from a static url or something."_

**Investigation result (grounded + web-verified):**

- Codex (ChatGPT-subscription auth) has **no machine-readable model-list endpoint**. OpenAI's
  `/v1/models` requires platform **API-key** auth, which a ChatGPT-subscription Codex login does not
  carry. OpenAI's own Codex models page (`developers.openai.com/codex/models` → redirects to
  `learn.chatgpt.com/docs/models`) is human-readable HTML with no JSON/enumeration API (confirmed by
  fetch). The interactive `/model` picker is a TTY (already ruled out by #869) AND is buggy — it
  omits the current gpt-5.6 ids (confirmed on Codex CLI v0.143.0). So there is no live source to
  probe for a CLI Codex provider.
- Therefore the concrete source is a **curated static list**, exactly like the existing anthropic
  CLI path — the same reliable-baseline decision #869/H5 already made, now extended to codex.

**Design:**

- Add an `"openai-compatible"` entry to `CLI_STATIC_MODELS` (`model-discovery.ts:43-46`) with the
  current Codex model ids, sourced from OpenAI's published Codex models doc
  (`learn.chatgpt.com/docs/models`), verified 2026-07-12:
  `gpt-5.6-sol` (reasoning), `gpt-5.6-terra` (interactive), `gpt-5.6-luna` (economy), plus the
  `gpt-5.6` alias; `gpt-5.4` / `gpt-5.4-mini` / `gpt-5.3-codex-spark` optional. Exclude
  ChatGPT-deprecated ids (`gpt-5.2`, `gpt-5.3-codex`).
- Run these through the existing `inferModel(id, "openai-compatible")` (`model-discovery.ts:210`)
  so capabilities + tier come from the same inference path as api_key discovery — no parallel
  logic. **Extend `inferTierFromModelId`** (`model-discovery.ts:198-202`): the current
  openai-compatible branch keys on `o[0-9]` / `mini` / `3.5` and would mis-tier the gpt-5.6 named
  variants — add sol→reasoning, terra→interactive, luna→economy (data-driven suffix map, still no
  hardcoded provider CODE path — it's the same static-data file the invariant already allows).
- Codex statics are inserted `active` (D1) and delete-and-replaced on each pass (D6); chat still
  rides the sentinel (D1 ordering). With D3, these ids also serve json over `codex exec` on a
  CLI-only instance.
- Staleness reality (state it plainly): a curated list drifts as OpenAI ships models. Mitigations:
  it lives in one data file; the sentinel (not a concrete id) is the chat default so drift never
  breaks chat; and the kept REST endpoints let an admin add a brand-new id by hand. A live
  enumeration would only be possible via an API-key OpenAI provider (`/v1/models`, already handled
  by the api_key discovery path) — which is the honest upgrade path if Ben adds an OpenAI key.

## UX walkthrough — before / after

**CLI provider (Ben's case).**
Before: sign in via Claude CLI → chat works (sentinel), but the provider card shows three "off"
model rows; News topic-add → _"Topic checking is unavailable right now"_ (a lie — it's a config
gap) or a raw 500; the "fix" is: enable a model → open Edit → tick json/economy checkboxes → bind →
raw AES-GCM 500 anyway, because the provider has no API credential.
After: sign in via Claude CLI → provider card appears with the sentinel ("Claude — default model")
plus the auto-detected statics, all active, capabilities + tiers inferred, read-only. Chat behavior
unchanged (sentinel). **News topic validation now works** — the json request routes through the
Claude CLI bridge (D3), the same tmux/herdr transport chat already uses, so `generateStructured`
returns valid JSON with zero API keys. Adding Codex later populates a second card the same way (D7).
Add an API key to any provider and its json transparently switches to the faster direct-HTTP path.
No Add. No Discover. No checkboxes.

**API-key provider.**
Before: create with key → models appear active (shipped) — but a typo'd key meant an empty
provider and a manual "Discover" after fixing it.
After: fixing the key on Save re-discovers automatically; an empty provider self-heals on the next
settings visit. The buttons are gone.

**Empty state copy** (replaces `:517-519`): reflects reality instead of assigning homework — e.g.
_"Models appear here automatically when the provider connects."_ (plus, for an API provider with a
failed probe, the existing soft "couldn't reach the provider's model list — check the key" note).

## Slicing

Three lanes. Lane A and Lane B are the frictionless-discovery core and can ship first; **Lane C is a
separable, higher-risk follow-on** — the spec is usable if Lane C is deferred, at the cost of json
staying needs-config on a CLI-only instance until it lands.

**Lane A — backend (packages/ai): discovery triggers, activation, clean-slate reconcile, Codex
statics, error guard.** D1 + D2(a–d server side) + D4 + D5 + D6 + D7. One shared
`discoverAndPersistModels` helper; sentinel-first resolver ordering;
`deleteModelsForProviderExceptSentinel`; `CLI_STATIC_MODELS` openai-compatible entry +
`inferTierFromModelId` extension; decrypt guard. Integration tests per acceptance criteria.
**Tier: security** — changes activation/routing and touches the credential-decrypt path; independent
security-lens review before merge per project rules. Estimated: ~1 agent build day.

**Lane B — frontend (apps/web): delete the manual surfaces.**
UI deletions (`AddModelForm`, discover button/`discoverMutation`, discovered-models picker, "add
one" empty-state copy) + honest empty-state copy. Net-negative diff (~250 lines removed from
`settings-ai-admin-pane.tsx`). Depends on Lane A being merged (so the empty state is truthful).
**Tier: routine.** Estimated: ~half agent day. Frontend-only QA gate (no PG suite) per
multi-agent-contention rule.

**Lane C — CLI structured-generation adapter (packages/ai port + packages/chat impl + wiring).**
Delivers D3: route `generateStructured`/`generateJson` through the CLI bridge for `auth_method='cli'`
providers so json works with zero API keys. **This is net-new — no CLI execution path exists for
`generate*` today** (verified: `generate-structured.ts:101-105` hard-wires `HttpApiAdapter`; chat's
one-shot engines `claude-print-chat-engine.ts` / `codex-exec-session.ts` only serve chat turns).
The pieces exist to assemble it cleanly, so it is not greenfield: (1) the retry/validation loop
(`generate-structured.ts:113-168`) is already adapter-agnostic — it only needs an adapter returning
`rawText`; (2) a `deps.createAdapter?` seam already exists (`:39-44`); (3) the tmux/herdr multiplexer
primitives are exported from `@jarv1s/ai` (`index.ts:24-27`). Work: define a `CliStructuredAdapter`
port in `packages/ai`, implement it in `packages/chat` (reuse the print/exec engines to run a
one-shot prompt-for-JSON, feed `rawText` back into the existing Ajv loop — reprompt-on-invalid comes
free), branch on `auth_method` at the `packages/module-registry` injection site
(`index.ts:513-524`), respecting the module-isolation invariant (ai can't import chat). Because CLI
turns run through the multiplexer, add a bounded timeout + concurrency guard so background json can't
starve interactive chat. **Tier: security/high-risk** — new transport for private prompts + new
execution surface; needs its own independent review, and arguably its own `task` issue since it is
materially larger than A/B. Estimated: **~2 agent days**, the dominant cost and risk of the whole
effort. Depends on Lane A (activation) but not Lane B.

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
5. **(Lane C) json routes through the CLI, not blocked.**
   `resolveModelForService(scopedDb, "module.news", { capability: "json" })` on a CLI-only instance
   returns a usable CLI-provider model (not `needs-config`); `generateStructured` against it executes
   via the injected `CliStructuredAdapter` and returns valid parsed JSON. Integration test with a
   stubbed CLI adapter returning a JSON string → `{ ok: true }`; a second test where the adapter
   returns malformed JSON first, valid second → the Ajv reprompt loop recovers.
6. **(Lane C) binding to a CLI-auth provider is allowed.** `PUT /api/ai/services/module.news/binding`
   with a model on a CLI-auth provider **succeeds** (no 400) and subsequent json calls route through
   the CLI bridge — the old block direction is explicitly removed. Test asserts a 2xx and a working
   resolution.
7. `generateStructured` against an **API-key** provider with an undecryptable credential (wrong-key
   envelope fixture) returns `{ ok: false, error: "needs_config" }` and logs a warning — the AES-GCM
   error string never reaches the result or an HTTP response (regression test for #981's raw-500).
   The CLI path never decrypts, so it cannot raise this at all.
8. `apps/web/src/settings/settings-ai-admin-pane.tsx` contains no `AddModelForm`, no
   `discoverMutation`/discover button, no discovered-models checkbox picker, no "add one to bring
   this provider online" copy; `EditModelForm`, disable toggle, and override switch remain.
   Existing pane e2e/screens updated.
9. **(D6) Clean-slate reconcile.** A fixture CLI provider holding the sentinel + a #870-era stale
   static + a manually-added row, after one discovery pass, holds exactly the sentinel + the current
   static list (all `active`); the manual row and the stale static are hard-deleted; the sentinel
   survives. Re-running is idempotent (same set, no duplicates).
10. **(D7) Codex/openai-compatible statics.** `CLI_STATIC_MODELS` has an `openai-compatible` entry;
    creating a codex CLI provider yields active, tier-inferred models (`gpt-5.6-sol`→reasoning,
    `-terra`→interactive, `-luna`→economy via the extended `inferTierFromModelId`). Unit test on the
    tier map + integration test on codex-provider creation.
11. No new migration files; full gate green (`pnpm verify:foundation`), including the unchanged
    `foundation.test.ts` migration list.

## Open questions for Ben (residual)

1. **Lane C scope & sequencing.** The CLI structured-json adapter (D3/Lane C) is net-new and the
   single largest, highest-risk piece (~2 agent days, new execution surface for private prompts). It
   is cleanly separable: Lanes A+B deliver frictionless discovery/activation immediately, with
   CLI-only json staying needs-config until C lands. Ship A+B first and file Lane C as its own `task`
   issue, or hold the whole thing until C is done so News "just works" from day one?
2. **CLI json concurrency budget.** Background json over the CLI bridge shares the tmux/herdr
   multiplexer with interactive chat. Spec assumes a bounded timeout + a low concurrency cap so a
   News-refresh burst can't stall your chat. Is a hard "chat always wins, json queues" priority the
   behavior you want, or is best-effort fair-share fine?
3. **Codex static-list upkeep.** The curated codex ids (D7) will drift as OpenAI ships models; the
   sentinel keeps chat safe and the REST endpoint lets you hand-add, but the static file needs
   occasional manual sync from `learn.chatgpt.com/docs/models`. Acceptable as a known maintenance
   chore, or do you want a periodic check that warns when the list looks stale?
