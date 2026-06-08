# Jarv1s Chat — Design Spec

- **Date:** 2026-06-08
- **Status:** Draft (awaiting review)
- **Type:** Epic (3 phases)
- **Supersedes:** the *interactive* chat path of M-A3 (worker + poll + per-thread one-shot sessions). M-A3 retains the non-interactive provider/tool foundation (assistant-tool execution, future briefings) and the bridge fixes in PR #20 (issue #17).

---

## 1. Summary

Jarv1s Chat is a live, drawer-based conversational + agentic assistant ("Jarvis"). The user opens a chat drawer and talks to Jarvis in real time. Under the hood, Jarvis is whichever **CLI** the user has configured (Claude / Codex / Gemini) driven inside a **persistent per-user tmux session**, with its transcript streamed to the drawer at record granularity. Jarvis has a persona, **acts on the user's behalf** through Jarv1s module tools (tasks/calendar/email/vault…) via MCP, and **remembers past conversations** via semantic recall.

Built in three ordered, individually-testable phases:

1. **Live chat runtime + drawer** — talk to Jarvis live (conversational).
2. **Agentic tools (MCP)** — Jarvis can act, gated by a configurable per-module policy.
3. **Recall** — Jarvis remembers past chats (episodic + fact/profile memory).

---

## 2. Goals / Non-goals

**Goals**
- A user can hold an open-ended, multi-turn, **live** conversation with Jarvis about anything.
- Jarvis is **provider-agnostic across CLI providers**: change the active chat provider in Settings (Claude → Codex) and the next turn uses it, **carrying the prior conversation forward**.
- Jarvis is **agentic**: it can read and (with authorization) write through Jarv1s module tools.
- Jarvis **remembers**: relevant past conversations are recalled into new chats.
- Every conversation is **persisted, RLS-scoped, and browsable**.

**Non-goals (this epic)**
- The **api_key / HTTP** interactive transport (deferred future alternative; M-A3's `HttpApiAdapter` stays for non-interactive use).
- **Token-by-token** streaming (record-level only).
- Multi-instance/horizontally-scaled session affinity (single-host assumption — see Risks).
- A module marketplace.

---

## 3. Background — what changes vs M-A3

M-A3 chat = browser → API stores pending msg + enqueues pg-boss job → worker runs a **one-shot** `claude` tmux session per thread, parses the transcript, flips the message to `stored`, browser **polls**. Problems surfaced in QA: it only worked single-turn, used per-thread throwaway sessions, and the UX was poll-based.

Jarv1s Chat replaces the **interactive** half with: a **persistent per-user session**, **streamed** (not polled), **multi-CLI**, **agentic**, **remembering**. The durable store (`chat_threads`/`chat_messages`) is reused. The pg-boss worker remains for **async** work (recall embedding/reconcile; future briefings), not for the live turn loop.

---

## 4. Hard-invariant compliance

- **Provider-agnostic AI** — Honored. Interactive chat is scoped to the **CLI transport class**; within it the capability router selects the user's active "chat" CLI provider — **no provider hardcoded**. (An ADR in `docs/architecture/decisions/` will record "interactive chat = CLI transport; api_key interactive deferred".)
- **DataContextDb only / AccessContext = {actorUserId, requestId}** — all DB access via `withDataContext`; repos take the branded handle.
- **Private by default / RLS / no admin bypass** — conversations, memory, and tool actions are owner-only; RLS applies to all actors. The MCP server runs every tool under the user's `actorUserId`.
- **Secrets never escape** — decrypted provider credentials, tokens, and `model_metadata` provider internals are never embedded, injected into prompts, logged, or sent in job payloads. Only message **body** text is embedded/injected.
- **Metadata-only job payloads** — recall/embed jobs carry only `{actorUserId, threadId, messageId}`.
- **Module isolation** — chat consumes `@jarv1s/ai`, `@jarv1s/db`, `@jarv1s/memory` via public APIs; never queries another module's tables directly. MCP tool surface = each module's declared tools.
- **Never edit applied migrations** — all new migrations are additive; module SQL lives in the owning module's `sql/`.

---

## 5. Core architecture

**Two layers:**

- **Conversation** — durable DB record (`chat_threads` + `chat_messages`); the thing the user sees, rereads, and that recall embeds. A `/clear` starts a new conversation.
- **CLI session** — an ephemeral per-user tmux process bound to one provider; the *engine* executing the active conversation. Fully reconstructible by replaying the conversation's turns.

```
Browser (chat drawer)
  │  POST /api/chat/turn {text}        ── send a message
  │  POST /api/chat/clear              ── new conversation (/clear)
  │  GET  /api/chat/stream  (SSE)      ── live transcript records
  │  GET  /api/chat/threads, /threads/:id  ── browse history
  ▼
API (Fastify) — ChatSessionManager (in-process, per-user registry)
  │  ensures one tmux session per user (jarv1s-chat-<userId>),
  │  launched in the user's neutral dir with the persona context file,
  │  + (Phase 2) the Jarv1s MCP server configured,
  │  + (Phase 3) recalled-memory block as the seed.
  │  pastes input → tails transcript → parses records → SSE out
  │  + persists each turn to chat_messages
  ▼
tmux: `claude` | `codex` | `gemini`  (per active provider, neutral cwd)
  └─ writes JSONL transcript ──► parsed by transcript-reader (per provider)

pg-boss worker (async, unchanged role): Phase 3 embed + reconcile jobs; future briefings.
```

**Provider switch** = active "chat" model changes in Settings → next turn: manager kills/leaves the old session, launches the new provider's session, replays the conversation's turns as seed, continues the same thread (turns stamped with the new provider/model).

---

## 6. Phase 1 — Live chat runtime + drawer

### 6.1 Pre-work spike (required first)
Hands-on verification of each CLI (findings flagged by research as unconfirmed):
- **Claude:** confirm `--append-system-prompt[-file]` text survives `/clear`; transcript at `~/.claude/projects/<encoded-cwd>/<id>.jsonl` (encoding fix already in #17).
- **Codex:** transcript path `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` — **confirm `.jsonl` vs `.jsonl.zst` (compression)**; `developer_instructions` / `model_instructions_file` config keys; `/clear` vs `/new`.
- **Gemini:** transcript path `~/.gemini/tmp/<hash>/chats/*.jsonl`; `GEMINI_SYSTEM_MD` replacement (must include `${AvailableTools}`); `/clear` semantics (`/chat` save/resume).
Output: a confirmed per-CLI capability matrix that the adapter contract is built against.

### 6.2 Components
- **`ChatSessionManager`** (new, in `packages/chat`) — owns per-user sessions: `ensureSession(user)`, `sendTurn(user, text)`, `clear(user)`, `switchProvider(user, model)`, `streamRecords(user)`, idle reaper. In-memory registry keyed by `userId`; tmux is the source of truth (sessions named `jarv1s-chat-<userId>` survive API restart and are re-discovered).
- **`CliChatEngine` adapter** (extends the M-A3 `ChatProviderAdapter`/`transcript-reader` work) — per provider: `launch(neutralDir, personaPath, mcpConfig?)`, `submit(text)`, `clear()`, `tailFrom(offset)`. Reuses the #17 transcript-dir encoding + record parsing; adds persistent-session semantics (the offset/multi-turn insight from #18 applies to *tailing*, not the dead worker path).
- **API routes** (`packages/chat` routes): `POST /api/chat/turn`, `POST /api/chat/clear`, `POST /api/chat/switch`, `GET /api/chat/stream` (SSE), plus existing thread browse routes.
- **Drawer UI** (`apps/web`) — a slide-in chat drawer: message log (record-level streaming incl. "working…"/activity), input field, "New chat" button (`/clear`), active-provider indicator, and a conversation-history list to reopen past threads (read-only render from DB).

### 6.3 Persona + neutral sandbox
- **Neutral per-user dir:** `${JARVIS_CHAT_HOME:-~/.jarvis/chat}/<userId>/` — created on first use, **outside the repo**, isolated per user. Contains the rendered persona context file(s).
- **Persona:** one source-of-truth persona, rendered to the per-CLI context filename (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`) in the neutral dir, so it auto-reloads after `/clear`. Draft persona (editable): *"You are Jarvis, <owner>'s personal assistant. Be concise, direct, and proactive. You can manage the user's tasks, calendar, email, and notes via your tools (ask before changing things unless told otherwise). You have memory of past conversations."* Dynamic context (recalled memories, provider-switch replay) is injected as the **seed first message**, not the persona file (most portable across CLIs).

### 6.4 Data model
Reuse `chat_threads` (= conversation) and `chat_messages` (= turns). Additions (new migration):
- `chat_threads`: `last_active_at` (drawer opens to the user's most-recent active thread); a way to mark the "current" conversation.
- `chat_messages`: stamp the **executed** provider/model on completion (audit found `updateMessageComplete` doesn't) — store in existing `model_metadata`.
- `/clear` closes the current thread, opens a new one. Provider-switch keeps the thread; subsequent turns stamped with the new provider.

### 6.5 Streaming & lifecycle
- **Streaming:** SSE server→client emits parsed transcript records (user echo, activity events, assistant reply) as they land; input via POST. Multiple drawers for one user fan-out the same SSE.
- **Lifecycle:** lazy start on first turn; ~30-min idle reaper kills the tmux session (tunable); next turn respawns + replays; one engine per user. Concurrent input while a turn is in-flight is queued/rejected (turn-at-a-time).

### 6.6 Error handling
- CLI not installed / not logged in → fast-fail with a clear status (don't hang to timeout — carry over the #19 concern).
- Transcript not found / parse gap → bounded retry then surfaced error.
- Session death mid-turn → respawn + replay, resurface.

### 6.7 Testing
- Unit: `CliChatEngine` per provider against recorded transcript fixtures (extend `ai-tmux-bridge.test.ts`); `ChatSessionManager` lifecycle (respawn/replay, idle reap, switch) with a fake engine.
- Integration: turn persistence + RLS through the worker-role-style tests; SSE endpoint auth (a user only streams their own session).
- E2E (Playwright, mocked engine): open drawer → send → stream → `/clear` → switch provider → reopen history.

---

## 7. Phase 2 — Agentic tools (MCP)

- **Jarv1s MCP server** exposing module-declared assistant tools (reuse M-A3 tool declarations + risk levels). Configured into the CLI at launch (`--mcp-config` / Codex `mcp_servers` / Gemini `mcpServers`).
- **Identity & RLS:** every tool call executes under the session's `actorUserId` via `withDataContext`. The MCP server authenticates the call to a specific user/session (per-session token); no cross-user access.
- **Policy model (per-module, configurable):** per-module default (reads allowed; writes default **confirm**) → per-tool override (allow/confirm/deny) → per-action confirmation. New modules (sports, finance…) ship their own tool set + default policy. Stored per-user.
- **Confirmation flow:** a write tool call produces a `confirmation_required` action request (reuse `ai_assistant_action_requests`); the drawer surfaces an **Approve / Deny** card describing the action; on approval the MCP server executes. "Always allow X" updates the policy.
- **Security:** the CLI runs **without bypass-permissions** and with its **native shell + file tools disabled** (Claude `--disallowedTools`/settings; Codex/Gemini equivalents — verify in the Phase-1 spike). **Only** policy-gated Jarv1s MCP tools can act. No host bash. Read/lookup needs are served by *specific bounded* MCP tools (web/vault search, calculator, …).
- **Testing:** MCP tool calls run under the worker/user role (RLS); confirmation gating (write blocked until approved); policy resolution (module default → override); secrets never surfaced.

---

## 8. Phase 3 — Recall (full two-tier)

Reuse `packages/memory` (do **not** build a parallel stack): `LocalEmbeddingProvider` (nomic, 768-dim, query/document prefixes built-in), `memory_chunks` (pgvector, HNSW, cosine `<=>`), `MemoryRetriever` (chat is its first consumer), `IngestionService` idempotency pattern.

**Build order (one stretch):**
1. **Episodic** — embed each completed **user+assistant turn-pair** (`source_kind='chat'`, `source_path=threadId`) in the chat worker after a turn stores. **Per-turn hybrid retrieval** (semantic + recency decay; `w_sim≈0.6, w_rec≈0.25`), top-K≈20 → dedup → inject 5–8 into the seed context (~1000-token cap, highest-scoring at start+end), with a cosine-threshold cache to skip redundant re-queries. Provenance (date/thread) cited in-chat.
2. **Fact/profile layer** — mem0-style extract→reconcile (ADD/UPDATE/DELETE/NOOP) run **async in the worker** (makes its own router-selected LLM calls), producing a small always-loaded fact set; temporal + provenanced; importance weighting.
3. **Controls** — on/off, **incognito/temporary chat**, and a memory-management UI (view/edit/delete).

**Migrations (new):**
- Add `'chat'` to the `source_kind` CHECK on `memory_chunks` (and `memory_file_index`).
- **Add `jarvis_worker_runtime` grants + RLS policy role entries to the memory tables** — they're app-runtime-only today; the worker will hit `42501` exactly like chat did pre-#17 (the same trap).
- Generalize `MemoryRepository.upsertFileChunks`'s hardcoded `'vault'`; add a `source_kind` filter to `vectorSearch`.

**Testing:** worker-role embed/retrieve (RLS, the grant regression); retrieval quality on fixtures; reconcile (dedup/supersede); incognito = no persistence/embedding; secrets never embedded.

---

## 9. Cross-cutting

- **Security/privacy:** chat content lives in the RLS DB (durable) + on-disk transcripts in the per-user neutral dir (ephemeral engine scratch, plaintext — flagged). The SSE/turn endpoints authorize the user to **their own** session only. The CLI runs agentic but with **native shell/file tools disabled and no bypass-permissions** — it can act *only* through policy-gated Jarv1s MCP tools (see §12).
- **Performance:** record-level streaming; local embeddings + HNSW keep per-turn recall cheap; idle reaping bounds resource use.
- **Testing strategy:** unit (engines, manager, policy, retrieval) + integration (RLS, persistence, MCP, recall grants) + E2E (drawer flows with a mocked engine). Real-CLI behavior covered by the Phase-1 spike + a small set of opt-in live smoke checks.

---

## 10. Risks & open questions

1. **CLI native shell/file access — RESOLVED (security).** The chat CLI runs **without bypass-permissions** and with its **native shell + file tools disabled entirely**. Rationale: the neutral cwd does NOT limit filesystem *reach* — the process runs as the host user and could read `~/.claude` creds, repo `.env`/DB strings, other users' dirs — and once Jarvis ingests untrusted content (Phase 2), prompt-injection + an action tool is an exfiltration chain; "read-only" shell isn't reliably classifiable. Jarvis's only powers are **policy-gated Jarv1s MCP tools**; read/lookup is served by *specific bounded* MCP tools. Running actual code is a future **sandboxed exec** MCP tool (container/namespace, no host FS, no/filtered network, non-priv user) — its own spec.
2. **CLI unknowns (Phase-1 spike).** Codex `.jsonl.zst` compression; Gemini transcript path/`/clear` semantics; system-prompt persistence across `/clear`. Resolved by the spike.
3. **Long-conversation context window.** Replay-on-switch and recall injection can exceed a CLI's window — needs summarization of older turns (deferred; flagged in Q2).
4. **Single-host assumption.** tmux sessions are node-local; multi-instance API needs sticky routing. Out of scope; documented.
5. **Multi-device concurrency.** Two drawers share one session; input is turn-at-a-time. Acceptable; documented.

---

## 11. Sequencing & roadmap

New **"Jarv1s Chat"** epic on top of M-A3. M-A3 keeps the non-interactive foundation + #17 (PR #20). #18 (worker multi-turn) and #19 (unattended) fold into this epic (#18 superseded; #19's fast-fail informs Phase 1 error handling and future briefings). Phases ship in order 1 → 2 → 3; each is independently verifiable and gated by `pnpm verify:foundation` + `pnpm audit:release-hardening`.

## 12. Decided defaults (settled at spec time)

- Runtime owner = **API (Fastify) in-process `ChatSessionManager`** + **SSE**; pg-boss worker stays async-only.
- One session per user; neutral dir `${JARVIS_CHAT_HOME:-~/.jarvis/chat}/<userId>/`.
- Reuse `chat_threads`/`chat_messages`; reuse `packages/memory` for recall.
- Persona: single source rendered to per-CLI context files; dynamic context via seed message.
- **Chat CLI security:** no bypass-permissions; native shell + file tools disabled; Jarvis acts only via policy-gated Jarv1s MCP tools; read/lookup via specific bounded MCP tools; sandboxed code-exec deferred to its own spec.
