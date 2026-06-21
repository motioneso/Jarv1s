# Spec — auto-register a default chat-capable model on provider login (#367)

**Status:** APPROVED 2026-06-20 (Ben — open questions resolved: `sonnet` alias default; no
re-register over a user-removed model).
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
   the user types nothing. **The default model id is the provider's ALIAS, not a pinned full id** —
   for anthropic, `sonnet` (claude resolves `--model sonnet` / `/model sonnet` to the current
   Sonnet), so the default never goes stale as Anthropic ships new Sonnets (Ben).
   2a. **The chat launch passes the resolved model.** `buildClaudeCommand` adds
   `--model <provider_model_id>` (e.g. `--model sonnet`) from the active model row, so the registered
   model actually takes effect (today the launch omits `--model` and rides the account default).
3. **No live discovery this phase.** The `/v1/models` API rejects the CLI OAuth token (verified 401)
   and the CLI has no list command; real discovery (driving the REPL `/model` picker, or API-key
   providers' `/v1/models`) is a **settings-level** follow-up, out of this spec.

## Design

- **Catalog default.** Add a `defaultChatModel { providerModelId, displayName }` to each supported
  provider's recipe/catalog entry (`packages/cli-runner/src/catalog.ts` or a shared AI provider
  defaults map) — anthropic → `{ providerModelId: "sonnet", displayName: "Claude Sonnet" }` (the
  alias, per decision 2). Data-driven per provider (agnostic).
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

1. Default model id = the **`sonnet` alias** (not a pinned full id), passed to claude via `--model`
   (Ben) — never goes stale across Sonnet releases.
2. **No re-registration over a user-removed model** — gate auto-register on "no active chat model
   exists for this provider", so a re-login never resurrects a model the founder deleted in Admin.
