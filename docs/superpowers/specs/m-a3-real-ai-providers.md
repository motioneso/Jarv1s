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
hardcoded** — the router selects whichever provider/model the operator configured, and a new
execution layer dispatches to the matching adapter.

The operator's primary use is **subscription-based**, not pay-per-token API billing. So the primary
transport is a **local-CLI bridge** that drives the user's already-installed, already-logged-in
`claude` / `codex` / `gemini` CLIs — chat runs on the user's subscription, and Jarv1s never handles
the subscription credential (it stays in the CLI's own config). A **BYO API key** transport is the
backup.

Because a CLI turn can take many seconds and the user wants to **see the agent working (not a stale
spinner)**, execution is **asynchronous** and the agent's intermediate activity is surfaced live in
a collapsible panel.

## Goals

1. Execute real chat completions for three providers: Claude (`anthropic`), Codex/OpenAI
   (`openai-compatible`), Gemini (`google`).
2. Two auth transports per provider, selected by config: **`cli`** (local CLI bridge, primary) and
   **`api_key`** (BYO key, backup).
3. Keep provider selection behind the existing capability router — no feature hardcodes a provider.
4. **Asynchronous execution** so the chat request never blocks on a long model turn.
5. **Surface the agent's "working/thinking" activity** live, in a **collapsible panel collapsed by
   default**, so the user can peek at progress and chat never looks stale.
6. Warn when a configured CLI binary is missing.
7. Prove it: configure each of the three providers, send a chat, get a real reply from each.

## Non-Goals (deferred)

- **Notes / vault grounding** (retrieval-augmented chat) → M-A4.
- **Token-streaming the final answer** — the reply arrives whole; only _progress/activity_ is live.
- **Tool/function calling execution** — existing tool-gating stays; tools remain `blocked`.
- **Native OAuth subscription login** — rejected as fragile/ToS-murky (those flows are built for the
  providers' first-party CLIs).
- **Per-end-user subscription identity** — the CLI bridge runs as the host's logged-in account (one
  shared host identity). Fine for single-user/household self-host; no per-user/per-request provider
  swap in v1.
- **tmux session eviction/concurrency limits** — v1 keeps a simple per-thread session; idle-timeout
  and caps come later.

## Resolved Decisions

All locked in the M-A3 brainstorm (do not re-open):

| #   | Decision          | Choice                                                                      | Why                                                                      |
| --- | ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Scope             | Real chat; no grounding, no token-streaming, no tools                       | Keep M-A3 focused; grounding is M-A4                                     |
| 2   | Providers         | Claude=`anthropic`, Codex/OpenAI=`openai-compatible`, Gemini=`google`       | Three providers prove the router isn't hardcoded                         |
| 3   | Primary transport | **Local CLI bridge — all providers via tmux**                               | Subscription-based; no token billing; Jarv1s never holds the credential  |
| 4   | Backup transport  | **API key** (BYO, encrypted at rest)                                        | Reuses existing `ai` credential plumbing; works without a local CLI      |
| 5   | Output parsing    | Read each CLI's **JSONL session transcript**, not screen-scrape the pane    | Structured + robust; pane stays for the human; scraping is fallback only |
| 6   | Execution         | **Async** via a pg-boss worker; metadata-only payload                       | A CLI turn is slow; never block the request; payload carries IDs only    |
| 7   | Progress          | Surface agent activity live in a **collapsible (collapsed) panel**          | User can peek at "working/thinking"; chat never looks stale              |
| 8   | UI updates        | **Polling** the messages endpoint (no SSE/WebSocket in v1)                  | Simplest live-ish update; matches non-token-streaming                    |
| 9   | CLI availability  | **Presence check only** (binary on PATH); auth errors surface on first call | Reliable auth-probing differs per CLI and is fragile — don't over-build  |
| 10  | tmux              | Bundle `tmux`; one per-thread session; **never** `claude -p`                | One inspectable mechanism; `claude -p`/print mode is changing            |
| 11  | Host identity     | CLI runs as the host account (single identity)                              | Fine for self-host; no per-user swap in v1                               |
| 12  | Rejected          | Native OAuth subscription login                                             | Fragile, ToS-murky, first-party-only                                     |

## Architecture

### Execution seam + async flow

Today `ChatRepository.appendUserMessage` resolves a route and writes the assistant message with a
status from `selectAssistantStatus(route, tools)`:

- `blocked` — a non-read tool was selected (unchanged)
- `no_model` — no chat-capable model configured (unchanged)
- `pending` — route available, but **execution disabled** ← M-A3 replaces this

M-A3 flow:

1. `appendUserMessage` stores the user message and an assistant message with status `pending`, then
   **enqueues a pg-boss job** carrying **only** `{ threadId, assistantMessageId, kind }`
   (metadata-only — no prompt content, no secrets).
2. The **worker** resolves the thread + history through `DataContextRunner` (scoped, RLS), selects
   the adapter via `createChatAdapter`, sets the assistant message to `working`, drives the turn,
   appends **activity events** as they arrive, and on completion writes the final reply body with
   status `stored` (or `error` with a clear message on failure). Never crashes the request.
3. The **web shell polls** the existing messages endpoint while a message is `pending`/`working`,
   rendering the activity panel and then the final reply.

Statuses: `pending` → `working` → `stored` | `error`. (`blocked`/`no_model` unchanged.)

### Provider adapter interface (new)

One small interface in the `ai` module, two transport implementations, plus an activity callback so
the worker can stream progress into the DB:

```ts
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatActivityEvent {
  kind: "thinking" | "tool" | "status" | "other";
  text: string;
}

export interface ChatProviderAdapter {
  /** Final answer arrives whole (no token-streaming). onActivity streams progress. */
  generateChat(input: {
    model: AiConfiguredModelSafeRow; // routed model (provider kind, provider_model_id, ...)
    messages: readonly ChatTurn[]; // thread history + new user turn
    onActivity?: (event: ChatActivityEvent) => void;
  }): Promise<{ text: string }>;
}
```

A factory is the **only** place that picks an adapter, keyed by `auth_method` then `provider_kind`:

```ts
createChatAdapter(provider: AiProviderConfigRow, deps): ChatProviderAdapter
//  auth_method === "cli"      -> TmuxBridgeAdapter(cliFor(provider.provider_kind))  // interactive CLI in tmux
//  auth_method === "api_key"  -> HttpApiAdapter(provider.provider_kind, decryptedKey)
```

No feature code names a provider; it asks the router for a model, loads that model's provider config,
and calls `createChatAdapter`.

### Transport A — CLI bridge (primary): all providers via tmux

Every `cli` provider runs as an **interactive CLI session inside its own detached tmux session**,
uniformly for `claude`, `codex`, `gemini`. (`claude -p`/print mode is being changed and must not be
used.) **Operator benefit:** if something hangs, attach to the live session
(`tmux attach -t <session>`) to see exactly what the CLI/model is doing.

Mechanism — identical for all three; only the binary, submit key, and transcript schema differ:

- **Session:** one detached tmux session **per chat thread** (persistent → free multi-turn context),
  created on first message, reused for later turns. (Eviction/caps deferred — see Non-Goals.)
- **Send:** `tmux send-keys`, using `load-buffer` + `paste-buffer` for multi-line/special-char
  prompts so the TUI receives them intact, then submit.
- **Wait + extract (structured, NOT screen-scraping):** tail the CLI's **on-disk JSONL session
  transcript**. Intermediate records become `ChatActivityEvent`s (thinking/tool/status); a complete
  assistant record is the unambiguous completion signal and its content is the reply.
- **`capture-pane` fallback only** if a CLI exposes no parseable transcript.

| provider_kind       | CLI binary | transcript source (verify path/schema at build)                                  |
| ------------------- | ---------- | -------------------------------------------------------------------------------- |
| `anthropic`         | `claude`   | session JSONL under `~/.claude/projects/<cwd>/<id>.jsonl`; **never** `claude -p` |
| `openai-compatible` | `codex`    | Codex session log/rollout (JSONL) — confirm location/format                      |
| `google`            | `gemini`   | Gemini session/log output (JSON/JSONL) — confirm location/format                 |

- **`tmux` is a new runtime dependency, bundled with the install** — required for all `cli` providers.
- **No credential handling:** login lives in each CLI's own config; Jarv1s stores no secret for
  `cli` providers.
- **Model selection:** pass `provider_model_id` via the CLI's model flag/command when supported.
- **Error capture:** timeout, dead session, or empty reply → clear assistant `error` message.
- **Risk (reduced, still real):** each CLI's transcript path/schema differs and can change across
  versions. Isolate the per-provider transcript reader behind one adapter so it can evolve without
  touching chat.

### Transport B — API key (backup)

HTTP adapter per `provider_kind` calling the provider's REST chat endpoint with the operator's
decrypted BYO key (existing AES-256-GCM `EncryptedAiSecret` storage in `ai/crypto.ts`):

- `anthropic` → Messages API
- `openai-compatible` → Chat Completions API (configurable `base_url` already exists)
- `google` → Gemini generateContent API

Non-token-streaming; map each provider's response to `{ text }`. (May emit a single coarse activity
event; rich activity is mainly a CLI-transport feature.)

### Activity / progress surfacing

- The assistant message accumulates an ordered **activity log** (list of `ChatActivityEvent`) while
  `working`, stored in `model_metadata` (or a dedicated column if it grows) — metadata only, never
  secrets.
- The web shell renders activity in a **collapsible panel, collapsed by default**, with a live
  "working…" affordance while status is `working`, then the final reply. Polling the messages
  endpoint drives updates.

### Provider config: `auth_method`

Add `auth_method: "cli" | "api_key"` to the AI provider config (DB column + DTO, default `api_key`
for back-compat). `cli` providers require no credential (`has_credential` stays false). New
migration file in `packages/ai/sql/` (never edit an applied migration).

### CLI availability check (presence only)

A small helper in `ai`: given a `provider_kind`, check the mapped CLI binary is on `PATH`. Surface
`cliAvailable` in the provider DTO so the web shell can warn ("`claude` not found"). Auth/login
problems are **not** probed up front — they surface as a clear `error` on the first real call.

### Files (anticipated; finalized in the plan)

| Action | File                                            | Purpose                                                               |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------- |
| Create | `packages/ai/src/chat-adapter.ts`               | `ChatProviderAdapter` + `ChatActivityEvent` + `createChatAdapter`     |
| Create | `packages/ai/src/adapters/tmux-bridge.ts`       | tmux session driver for all `cli` providers (create / send / inspect) |
| Create | `packages/ai/src/adapters/transcript-reader.ts` | Per-provider JSONL transcript reader (activity + reply + completion)  |
| Create | `packages/ai/src/adapters/http-api.ts`          | API-key HTTP transport per provider kind                              |
| Create | `packages/ai/src/cli-availability.ts`           | CLI + tmux presence detection helper                                  |
| Create | `packages/ai/sql/00NN_ai_auth_method.sql`       | `auth_method` column (RLS unchanged)                                  |
| Create | `packages/chat/src/worker.ts` (or jobs.ts)      | pg-boss handler: drive the turn, write activity + reply               |
| Modify | `packages/chat/src/repository.ts`               | Enqueue job + `working`/`stored`/`error` statuses + activity log      |
| Modify | `packages/chat/src/manifest.ts`                 | Declare the chat-execution queue                                      |
| Modify | `packages/ai/src/repository.ts` / `routes.ts`   | `auth_method` read/write; `cliAvailable` in DTO                       |
| Modify | `packages/shared/src/ai-api.ts`, `chat-api.ts`  | `authMethod`, `cliAvailable`, activity DTOs                           |
| Modify | `apps/web/src/chat/*`                           | Collapsible activity panel + polling                                  |
| Modify | `packages/db/src/types.ts`                      | `auth_method` column; activity/status types                           |
| Tests  | `tests/integration/ai.test.ts`, `chat.test.ts`  | Adapter selection, async flow, activity, presence (mocked)            |

## Testing

- **Adapter selection:** factory returns CLI adapter for `auth_method=cli`, HTTP for `api_key`,
  keyed by `provider_kind`.
- **tmux bridge + transcript reader (mocked):** stub the tmux send boundary and feed a fixture JSONL
  transcript — assert prompt send, activity events parsed from intermediate records, completion from
  a complete assistant record, reply extraction, and dead-session/timeout → `error`, per provider.
- **HTTP API (mocked):** stub the HTTP boundary per provider; assert request shape and
  response→`{ text }`; no key in logs.
- **Async chat flow:** `appendUserMessage` stores `pending` + enqueues a metadata-only job; the
  worker (mocked adapter) transitions `working` → `stored`, appends activity, records
  provider/transport in `model_metadata`; failure → `error`. `no_model`/`blocked` unchanged.
- **CLI availability:** helper reports unavailable when binary absent; DTO surfaces `cliAvailable`.
- **Manual smoke (not in CI):** real `claude`/`codex`/`gemini` on the host return live replies with
  visible activity; no API keys or live calls in the automated suite.

## Exit Criteria

1. `pnpm verify:foundation` green; `pnpm audit:release-hardening` green.
2. Each provider can be configured `auth_method=cli` and produce a real chat reply via its tmux CLI
   session (manual smoke); and `auth_method=api_key` via mocked HTTP in tests.
3. The capability router still selects the active model; no feature hardcodes a provider/model.
4. Chat is async: the request returns immediately with a `pending` assistant message; the worker
   fills it; the UI shows live activity in a collapsed-by-default panel and then the final reply.
5. A missing CLI binary yields a clear warning (DTO) and a clear `error` at call time, not a crash.
6. Integration tests cover adapter selection, both transports (mocked), the async flow, and activity.
7. Epic issue #4 exit-criteria checked; milestone closed (orchestrator-verified, per the
   `verify-agent-claims` rule).

## Hard Invariants Honored (from CLAUDE.md)

- **Provider-agnostic AI** — selection stays in the router + `createChatAdapter` factory.
- **Metadata-only job payloads** — the chat-execution job carries `{ threadId, assistantMessageId,
kind }` only; the worker loads content via `DataContextRunner`. No prompt content or secrets in
  the payload.
- **Secrets never escape** — API keys stay AES-256-GCM encrypted, never in logs/payloads/frontend;
  `cli` providers store no secret. Activity logs are scrubbed of any secret-like content.
- **DataContextDb / AccessContext** — worker executes within the scoped-DB flow; `AccessContext`
  shape unchanged.
- **Never edit applied migrations** — `auth_method` ships as a new migration file.
- **Module isolation** — `chat` consumes `ai` only through its public API (router + adapter factory).
