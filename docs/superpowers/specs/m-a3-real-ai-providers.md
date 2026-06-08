# M-A3: Real AI Provider Calls

**Status:** Draft (awaiting review)
**Date:** 2026-06-07
**Owner:** Ben
**GitHub:** Epic issue #4 · Milestone M-A3

---

## Context

Jarv1s has a chat module and an AI capability-router, but the router is **metadata-only**: it
resolves which configured model _would_ handle a `chat` capability, then stops. The seam is in
`packages/chat/src/repository.ts` — `appendUserMessage` resolves a route and writes an assistant
message with status `pending` and the placeholder body _"Chat model route is configured. Provider
execution is disabled in this slice."_ No model is ever called.

M-A3 makes chat **real**: when a chat-capable model is routed, Jarv1s actually invokes the
configured provider and stores the model's reply. Per the hard invariant, **no provider is
hardcoded** — the router selects whichever provider/model the operator configured, and the new
execution layer dispatches to the matching adapter.

The operator's primary use is **subscription-based**, not pay-per-token API billing. So the first
transport is a **local-CLI bridge** that drives the user's already-installed, already-logged-in
`claude` / `codex` / `gemini` CLIs — the chat runs on the user's subscription, and Jarv1s never
handles the subscription credential (it stays in the CLI's own config). A **BYO API key** transport
is the backup.

## Goals

1. Execute real chat completions for three providers: Claude (`anthropic`), Codex/OpenAI
   (`openai-compatible`), Gemini (`google`).
2. Two auth transports per provider, selected by config: **`cli`** (local CLI bridge, primary) and
   **`api_key`** (BYO key, backup).
3. Keep provider selection behind the existing capability router — no feature hardcodes a provider.
4. Detect CLI availability and warn the operator when a configured CLI is missing or not logged in.
5. Prove it: configure each of the three providers, send a chat, get a real reply from each.

## Non-Goals (deferred)

- **Notes / vault grounding** (retrieval-augmented chat) → M-A4.
- **Streaming responses** — M-A3 is non-streaming (request → full reply).
- **Tool/function calling execution** — the existing tool-gating stays; tools remain `blocked`.
- **Async/worker execution** — M-A3 calls inline in the request; background execution is later.
- **Native OAuth subscription login** — rejected as fragile/ToS-murky (those flows are built for the
  providers' first-party CLIs).
- **Per-end-user subscription identity** — the CLI bridge runs as the host's logged-in account
  (one shared host identity). Acceptable for single-user/household self-host; initial
  implementation does not let users swap providers per-request.

## Resolved Decisions

All locked in the M-A3 brainstorm (do not re-open):

| #   | Decision          | Choice                                                                    | Why                                                                                                |
| --- | ----------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Scope             | Real chat only; no grounding, no streaming, no tools                      | Keep M-A3 small and shippable; grounding is M-A4                                                   |
| 2   | Providers         | Claude=`anthropic`, Codex/OpenAI=`openai-compatible`, Gemini=`google`     | Three providers prove the router isn't hardcoded                                                   |
| 3   | Primary transport | **Local CLI bridge — all providers via tmux** (`claude`/`codex`/`gemini`) | Subscription-based; no token billing; Jarv1s never holds the credential; sessions stay inspectable |
| 4   | Backup transport  | **API key** (BYO, encrypted at rest)                                      | Reuses existing `ai` credential plumbing; works without a local CLI                                |
| 5   | Rejected          | Native OAuth subscription login                                           | Fragile, ToS-murky, first-party-only                                                               |
| 6   | Execution         | Inline, synchronous, in the chat REST request                             | Simplest for non-streaming; async/worker is future                                                 |
| 7   | CLI availability  | Detect + warn (config time and call time)                                 | Clear failure when a CLI is missing/not authed                                                     |
| 8   | Host identity     | CLI runs as the host account (single identity)                            | Fine for self-host; no per-user swap in v1                                                         |
| 9   | Claude transport  | Interactive `claude` in tmux — **never** `claude -p`                      | `claude -p`/print mode is changing                                                                 |
| 10  | tmux              | Bundle `tmux`; all `cli` providers run in a per-thread tmux session       | One mechanism; operator can attach to inspect a hung/slow session                                  |
| 11  | Output parsing    | Read each CLI's **JSONL session transcript**, not screen-scrape the pane  | Structured + robust; pane stays for the human; scraping is fallback only                           |

## Architecture

### The execution seam

Today `ChatRepository.appendUserMessage` writes the assistant message with a status from
`selectAssistantStatus(route, tools)`:

- `blocked` — a non-read tool was selected (unchanged in M-A3)
- `no_model` — no chat-capable model configured (unchanged)
- `pending` — route available, but **execution disabled** ← M-A3 replaces this

M-A3: when the route is available and no blocking tool is selected, call the provider, store the
reply as the assistant message body with status `stored` (or the existing terminal "complete"
status), and record provider/model + transport in `model_metadata`. On provider failure, store a
clear error body with an `error` status (add one if absent) — never crash the request.

### Provider adapter interface (new)

A single small interface in the `ai` module, with two transport implementations:

```ts
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatProviderAdapter {
  /** Non-streaming. Returns the model's full reply text. */
  generateChat(input: {
    model: AiConfiguredModelSafeRow; // routed model (provider kind, provider_model_id, ...)
    messages: readonly ChatTurn[]; // thread history + new user turn
  }): Promise<{ text: string }>;
}
```

A factory is the **only** place that picks an adapter, keyed by the provider config's
`auth_method` then `provider_kind`:

```ts
createChatAdapter(provider: AiProviderConfigRow, deps): ChatProviderAdapter
//  auth_method === "cli"      -> TmuxBridgeAdapter(cliFor(provider.provider_kind))  // interactive CLI in tmux
//  auth_method === "api_key"  -> HttpApiAdapter(provider.provider_kind, decryptedKey)
```

No chat/feature code names a provider; it asks the router for a model, loads that model's provider
config, and calls `createChatAdapter`.

### Transport A — CLI bridge (primary): all providers via tmux

Every `cli` provider runs as an **interactive CLI session inside its own detached tmux session** —
uniformly for `claude`, `codex`, and `gemini`. (`claude -p` / print mode is being changed and must
not be used; driving the interactive session via tmux avoids that and applies one mechanism to all
three.) **Operator benefit:** if the frontend hangs, the operator can attach to the live session
(`tmux attach -t <session>`) and see exactly what the CLI/model is doing.

Mechanism — identical for all three; only the binary, submit key, and extract heuristics differ:

- **Session:** one detached tmux session **per chat thread** (persistent → multi-turn context for
  free), created on first message, reused for later turns, killed on idle timeout / thread close;
  cap concurrent sessions.
- **Send:** `tmux send-keys`, using `load-buffer` + `paste-buffer` for multi-line / special-char
  prompts so the TUI receives them intact, then submit.
- **Wait + extract (structured, NOT screen-scraping):** read the CLI's **on-disk JSONL session
  transcript**, not the rendered pane. Each CLI persists its turns as structured records; tail the
  transcript for the new assistant message — a complete assistant record is the unambiguous
  completion signal, and its content is the reply (no ANSI/chrome to strip). The tmux pane exists
  for the human inspector; the machine reads JSONL.
- **`capture-pane` is a fallback only** — used solely if a given CLI exposes no parseable transcript.

| provider_kind       | CLI binary | structured-output source (verify exact path/schema at build)                                |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `anthropic`         | `claude`   | session transcript JSONL under `~/.claude/projects/<cwd>/<id>.jsonl`; **never** `claude -p` |
| `openai-compatible` | `codex`    | Codex session log/rollout (JSONL) — confirm location/format                                 |
| `google`            | `gemini`   | Gemini session/log output (JSON/JSONL) — confirm location/format                            |

- **`tmux` is a new runtime dependency, bundled with the install** — required for all `cli`
  providers.
- **No credential handling:** the subscription/login lives in each CLI's own config; Jarv1s stores
  no secret for `cli` providers.
- **Model selection:** pass `provider_model_id` via the CLI's model flag/command when supported;
  otherwise the CLI's configured default is used (documented).
- **Error capture:** timeout, dead session, or empty reply → clear assistant error message, never a
  crashed request.
- **Risk (reduced):** parsing each CLI's JSONL transcript is far more robust than screen-scraping,
  but each CLI's transcript path/schema differs and can change across CLI versions. Isolate the
  per-provider transcript reader behind one adapter (with `capture-pane` as a last-resort fallback)
  so it can evolve without touching chat. Confirm each CLI's transcript format at build.

### Transport B — API key (backup)

HTTP adapter per `provider_kind` calling the provider's REST chat endpoint with the operator's
decrypted BYO key (existing AES-256-GCM `EncryptedAiSecret` storage in `ai/crypto.ts`):

- `anthropic` → Messages API
- `openai-compatible` → Chat Completions API (configurable `base_url` already exists)
- `google` → Gemini generateContent API

Non-streaming; map each provider's response to `{ text }`.

### Provider config: `auth_method`

Add `auth_method: "cli" | "api_key"` to the AI provider config (DB column + DTO, default
`api_key` for back-compat). For `cli` providers, no credential is required (`has_credential`
stays false). A new migration adds the column to the `ai` module's `sql/` directory (new file,
never edit an applied migration).

### CLI availability check

A small helper in `ai`: given a `provider_kind`, check the mapped CLI is on `PATH` and reports a
logged-in status (best-effort, e.g. a fast `--version` / lightweight auth probe). Surface results:

- **Config time:** the provider config DTO exposes `cliAvailable` so the web shell can warn
  ("`claude` CLI not found or not logged in").
- **Call time:** if a `cli` provider is invoked while unavailable, the adapter throws a clear,
  actionable error captured as the assistant message.

### Files (anticipated; finalized in the plan)

| Action | File                                            | Purpose                                                                                  |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Create | `packages/ai/src/chat-adapter.ts`               | `ChatProviderAdapter` interface + `createChatAdapter` factory                            |
| Create | `packages/ai/src/adapters/tmux-bridge.ts`       | tmux session driver for all `cli` providers (session create / send / inspect)            |
| Create | `packages/ai/src/adapters/transcript-reader.ts` | Per-provider JSONL session-transcript reader (reply + completion); capture-pane fallback |
| Create | `packages/ai/src/adapters/http-api.ts`          | API-key HTTP transport per provider kind                                                 |
| Create | `packages/ai/src/cli-availability.ts`           | CLI + tmux presence/auth detection helper                                                |
| Create | `packages/ai/sql/00NN_ai_auth_method.sql`       | `auth_method` column (+ RLS unchanged)                                                   |
| Modify | `packages/ai/src/repository.ts`                 | Read/write `auth_method`; expose for adapter selection                                   |
| Modify | `packages/ai/src/routes.ts`                     | Accept `auth_method` on provider create/update; `cliAvailable` in DTO                    |
| Modify | `packages/shared/src/ai-api.ts`                 | `authMethod`, `cliAvailable` on provider DTOs                                            |
| Modify | `packages/chat/src/repository.ts`               | Replace the `pending` stub with real execution via the adapter                           |
| Modify | `packages/db/src/types.ts`                      | `auth_method` column type                                                                |
| Tests  | `tests/integration/ai.test.ts`, `chat.test.ts`  | Adapter selection, auth_method, execution (mocked transports)                            |

## Testing

- **Adapter selection:** `createChatAdapter` returns the CLI adapter for `auth_method=cli` and the
  HTTP adapter for `auth_method=api_key`, keyed correctly by `provider_kind`.
- **tmux bridge + transcript reader (mocked):** stub the tmux send boundary and feed a fixture
  JSONL transcript — assert prompt send, completion detection from a complete assistant record,
  per-provider reply extraction, and dead-session/timeout → clear error, for each provider.
- **HTTP API (mocked):** stub the HTTP boundary per provider; assert request shape and
  response→`{ text }` mapping; no key in logs.
- **Chat execution:** with a routed `cli` model (mocked), `appendUserMessage` stores a real
  assistant body with status `stored` and provider/transport in `model_metadata`; with no model →
  `no_model`; with a non-read tool → `blocked` (unchanged).
- **CLI availability:** helper reports unavailable when binary absent; provider DTO surfaces
  `cliAvailable`.
- **Manual smoke (not in CI):** real `claude`/`codex`/`gemini` on the host return live replies;
  no API keys or live calls in the automated suite.

## Exit Criteria

1. `pnpm verify:foundation` green; `pnpm audit:release-hardening` green.
2. Each of the three providers can be configured with `auth_method=cli` and produce a real chat
   reply via the local CLI (manual smoke) — and with `auth_method=api_key` via mocked HTTP in tests.
3. The capability router still selects the active model; no feature hardcodes a provider/model.
4. A missing/unauthed CLI yields a clear warning (config DTO) and a clear error (call time), not a
   crash.
5. Integration tests cover adapter selection, both transports (mocked), and the chat execution seam.
6. Epic issue #4 exit-criteria checked; milestone closed (orchestrator-verified, per the
   `verify-agent-claims` rule).

## Hard Invariants Honored (from CLAUDE.md)

- **Provider-agnostic AI** — selection stays in the router + `createChatAdapter` factory; no
  feature names a provider.
- **Secrets never escape** — API keys stay AES-256-GCM encrypted at rest and never reach logs,
  payloads, or the frontend; `cli` providers store no secret at all (it lives in the CLI config).
- **DataContextDb / AccessContext** — chat execution stays within the existing scoped-DB flow;
  `AccessContext` shape unchanged.
- **Never edit applied migrations** — `auth_method` ships as a new migration file in
  `packages/ai/sql/`.
- **Module isolation** — `chat` consumes `ai` only through its public API (the router + adapter
  factory), not its internals or tables.
- **No metadata-only-payload violation** — execution is inline (no pg-boss job), so no provider
  content/secret enters a job payload.
