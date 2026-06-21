# Spec — auto-register a default chat-capable model on provider login (#367)

**Status:** APPROVED 2026-06-20 (Ben — open questions resolved: interactive/account `"default"`
sentinel for every loginable provider, override-in-settings — SUPERSEDES the earlier `sonnet`-pin;
no re-register over a user-removed model).
**Tracks:** #367. Part of #342. The mechanism #365's onboarding flow triggers; also reusable when a
provider is connected from settings.
**Goal:** after a provider logs in (`ready`), the user has a **working chat-capable model with zero
manual entry** — no Admin → Assistant & AI → Add provider → Add model detour.

## Problem

Chat resolves the active model via `selectChatModelForUser` (`packages/ai/src/repository.ts`) →
needs an AI **provider config** + a `chat`-capable **model** row (status `active`, provider
`active`). Installing + logging in a CLI provider creates **neither**, so chat fails with _"No active
chat-capable model is configured."_ Today the only fix is hand-building both in Admin (the flow Ben
dislikes), typing a model id.

## Decisions (locked in interview)

1. **Auto-register on login `ready`.** When a provider's login settles `ready`, the system creates
   (idempotently) the AI provider config + a default `chat`-capable model for it, so chat works
   immediately.
2. **Single default model, no picker, no manual id (option c).** Register one default per provider;
   the user types nothing. **The default is the provider's INTERACTIVE/ACCOUNT model — the
   `"default"` sentinel id, NOT a pinned model id** (Ben directive 2026-06-20, SUPERSEDES the earlier
   `sonnet`-pinning of 2a). Chat must never require model selection; the auto-registered default
   rides whatever model the CLI/account is set to, so it can never go stale. A concrete pinned id is
   used ONLY when the founder picks an explicit **override in settings**. This applies to EVERY
   loginable provider kind (currently anthropic + openai-compatible; google/gemini is blocked +
   not loginable), keeping the feature fully provider-agnostic — the user never types a model for
   any provider.
   2a. **The chat launch passes `--model` ONLY for a concrete override.** The launch builders
   (`buildClaudeCommand` / `buildCodexCommand` / `buildGeminiCommand`) emit `--model <id>` UNIFORMLY
   only when the active model id is a concrete settings override; for the `"default"` sentinel (or no
   model) they OMIT `--model` so the CLI rides its own interactive/account model. The `--model`
   plumbing (`EngineLaunchOpts.model` → `RpcLaunchParams.model`) is kept for the override path.
3. **No live discovery this phase.** The `/v1/models` API rejects the CLI OAuth token (verified 401)
   and the CLI has no list command; real discovery (driving the REPL `/model` picker, or API-key
   providers' `/v1/models`) is a **settings-level** follow-up, out of this spec.

## Design

- **Catalog default.** A shared AI provider defaults map (`DEFAULT_CHAT_MODELS` in
  `packages/ai/src/auto-register.ts`) holds a `defaultChatModel { providerModelId, displayName, … }`
  for each loginable provider kind — anthropic → `{ providerModelId: "default", displayName:
"Claude (default model)" }`, openai-compatible → `{ providerModelId: "default", displayName:
"Codex (default model)" }` (the `"default"` sentinel = the CLI's interactive/account model, per
  decision 2). Data-driven per provider (agnostic); a kind absent from the map is simply not
  auto-registered.
- **Registration mechanism** (`packages/ai/src/repository.ts` + a small service): on login `ready`,
  idempotently:
  1. ensure an AI **provider config** for the provider (`authMethod: "cli"`, no credential — already
     a supported shape per `CreateAiProviderConfigRequest`), reusing an existing one if present;
  2. ensure a **model** row from the catalog default (`capabilities: ["chat", …]`, `status: "active"`,
     a sensible `tier`), if the provider has no active chat model yet.
     Idempotent: re-login or a second provider must not duplicate rows; never downgrade a model the
     founder later customized in Admin.
- **Trigger points:** the onboarding login flow (#365) and the settings "connect/login a provider"
  path call this same service — registration is not onboarding-specific.
- **Selection:** existing `selectChatModelForUser` then resolves it (active + chat capability). No
  change to the resolver; this just guarantees a row exists.

## Provider-agnostic

The default lives in per-provider catalog data; the registration service is generic over
`providerKind`. Adding a provider = a catalog `defaultChatModel` entry, no new code path.

## Test plan

- Unit (ai repository/service): on `ready`, creates provider-config + chat model from the catalog
  default; **idempotent** (re-run creates nothing new); does not clobber a user-customized model;
  `selectChatModelForUser` then returns it.
- Integration: simulate a login→ready and assert a chat-capable model becomes active for the user.
- E2E: covered by #365's "chat works after install.sh" verdict.

## Security / invariants

- No credential is stored for CLI providers (`authMethod: "cli"`); the provider's auth is the
  cli-runner token store (#363). Provider-agnostic AI invariant preserved — features still request
  the `chat` capability; the router selects this model.
- RLS/ownership: the provider config + model are instance-level admin config (owner-gated), same as
  the existing Admin create paths — reuse `assertInstanceAdmin`.

## Resolved (2026-06-20)

1. Default model id = the **`"default"` interactive/account sentinel** for EVERY loginable provider
   (Ben, 2026-06-20 — SUPERSEDES the earlier `sonnet`-pin). Chat never requires model selection; the
   launch omits `--model` for the sentinel so the CLI rides its own interactive/account model, and
   passes `--model <id>` (uniformly across claude/codex/gemini) ONLY for an explicit settings
   override. Never goes stale; fully provider-agnostic.
2. **No re-registration over a user-removed model** — gate auto-register on "no active chat model
   exists for this provider", so a re-login never resurrects a model the founder deleted in Admin.
