# In-container CLI chat (BYO-provider) — Master Design Spec

**Status:** approved-pending-user-signoff · **Date:** 2026-06-20 · **Owner:** Ben + Coordinator (GLM `ses_11cb3c6d`)
**GitHub:** #342 (Phase 2, epic #47, milestone #11 "Portable, Deployable & Multi-user")
**Grounded on:** `origin/main` `ff34061` (worktree `/home/ben/jarvis-342-build`)
**Supersedes / evolves:** ADR 0008 (reversed by new ADR 0010 — host-native → in-container topology);
extends spec `2026-06-12-p2-portable-cli-chat-adapter-design.md` (the Multiplexer seam, now run inside
a sidecar). Obsoletes the host-bridge mounts added by PR #344's predecessor and `JARVIS_HOST_CLIS`
(#341, superseded).
**Frozen RPC contract (v2):** `docs/superpowers/specs/2026-06-20-cli-runner-rpc-contract.md` — the
wire-level `launch / submit / readNew / kill / isAlive` shape + the non-session `listLiveSessions` /
`probeProvider` verbs + the auth hello + `bootId` + the canonical 4-lane file partition are defined there
and **referenced, not duplicated**, below. The contract was re-frozen as v2 after three adversarial reviews
(2 Claude critics + Codex).

> This is the **master spec governing all four phases** of #342. It locks the topology, the
> isolation boundary, the volume/mount matrix, the token-ownership model, the file-by-file refactor
> surface, and the per-phase acceptance criteria. The per-phase build plans descend from the approved
> plan `docs/superpowers/plans/2026-06-20-in-container-cli-chat.md` (locked via `/grill-me-codex`
> Act 1: R1→R2→R3→R4, all R4 arbiter-accepted).

---

## 1. Problem & Goal

Live chat works on Ben's host because the `claude` / `codex` / `agy`(Gemini) CLIs run **on the host**
under the operator's personal auth, driven through a host **tmux** server whose socket is bind-mounted
into the `api`/`worker` containers (see `infra/docker-compose.prod.yml:162` and the RO `~/.claude` /
`~/.codex` / `~/.gemini` mounts at `:167-169`, plus the shared neutral-dir at `:172`). That topology
is the single biggest "prototype vs product" gap for the containerized deploy (#342):

1. **Not self-contained.** A fresh container deploy has no host tmux server and no host CLI auth, so
   live chat is dead unless the operator has those running on the host with matching uid.
2. **Secret/data leakage surface.** The app containers mount the operator's real CLI auth directories
   and share a tmux socket with the host — a coupling that puts CLI auth tokens and transcripts on the
   same volume boundary as app code, and assumes a host tmux server the household may not run.
3. **No on-demand provider story.** Providers must be pre-installed and pre-authenticated on the host.
   There is no path for a user to pick a provider in onboarding and have Jarv1s install + log them in.

**Goal:** make live chat work in the containerized deploy by running the multiplexer **and** the
provider CLIs **inside a dedicated `cli-runner` sidecar container**, isolated from app
secrets/vault/db. The user picks a provider → Jarv1s installs the CLI on-demand into a sidecar-only
volume → the user logs in through a presentation layer → chat works. **Auth/billing is the CLI's
concern, not Jarv1s's** (BYO-provider). The only `api`↔`cli-runner` coupling is a private `0600` Unix
socket carrying a thin RPC; the API mounts **no** CLI-data volumes.

**MVP providers:** `claude` (`@anthropic-ai/claude-code`, npm) · `codex` (`@openai/codex`, npm with
arch `optionalDependencies`) · `google` → **`agy`** = Antigravity CLI (versioned artifact + pinned
SHA512, self-update disabled; spike-gated — if those guarantees can't be met, `agy` ships blocked and
we launch with claude + codex).

---

## 2. Scope

### In scope

- A **`cli-runner` sidecar service** that is the isolation boundary: runs tmux + the provider CLIs
  with **only** the `tools` + `auth/home` volumes + a sanitized env (no `BETTER_AUTH_SECRET`, no
  `JARVIS_AI_SECRET_KEY`, no DB URLs, no vault). Exposes the frozen RPC over a private Unix socket.
- A **root one-shot init service** that `chown`s the named volumes to `JARVIS_HOST_UID` before the
  non-root `api`/`worker`/`cli-runner` services start.
- Refactor of the in-process `CliChatEngineImpl` into a **thin socket RPC client** (`api` side) +
  the engine impl running **inside `cli-runner`** (server side). The `CliChatEngine` interface
  (`packages/chat/src/live/types.ts`) is the contract boundary and is **preserved unchanged**.
- **Removal of the host bridge:** delete the host tmux-socket mount and the RO `~/.claude` /
  `~/.codex` / `~/.gemini` mounts and the shared neutral-dir mount from the prod compose file.
- **Secrets out of tmux launch lines:** the MCP bearer / provider config move out of `send-keys`
  argv into `0600` files **only** (`tmux set-environment` is FORBIDDEN — `show-environment` is a capture
  surface; v2 review).
- **API-owned MCP token model + reconciliation:** the API mints/tracks/revokes MCP session tokens;
  `cli-runner` cannot revoke them; the API reconciles its registry and kills orphaned sessions over
  RPC whenever `cli-runner` (re)connects.
- An **on-demand installer** (Phase 2): server-side allowlist recipes, serialized + atomic-promote +
  rollback install into the `tools` volume, with a persisted provider state machine.
- A **login presentation layer** (Phase 3): run provider login in a captured tmux session, surface
  URL/device-code to the UI, persist tokens into the `auth/home` volume; per-provider smoke gate.
- **Detection cleanup** (Phase 4): `install.sh` stops writing `JARVIS_HOST_CLIS`; in-container CLI
  presence comes from a sidecar PATH probe over RPC, not a host declaration. ADR 0010 landed.

### Out of scope

- GLM / opencode as a chat provider (fast-follow).
- On-demand **mux** choice (herdr-in-container etc.) — tmux is the bundled default; the seam stays.
- **API-key (HTTP) chat engine** — rejected for this phase; CLI-only.
- Host CLI login reuse / host-auth import (dropped — BYO inside the container instead).
- Apple `container` runtime as a *claimed-supported* runtime (compatible by design; deploy-docs
  follow-up only — not asserted here).
- uid-per-user OS isolation / non-operator (web-user) attach / privileged-launcher (the deferred
  follow-on milestone from the 2026-06-12 spec §10; unchanged by this spec).
- Embeddings containerization. Embeddings stay **in-process in the API container** (M-A1
  `LocalEmbeddingProvider`); reversing ADR 0008 must not couple them to the chat sidecar (ADR 0010
  scopes this explicitly).
- DB-backed token persistence across API restart (token registry remains in-memory; restart
  reconciliation is the recovery mechanism — see §5.4).

---

## 3. Locked Decisions

Lifted from the approved plan (R4-locked; arbiter accepted all R4 revisions). These are decisions,
not descriptions — violating any of them is a blocker for the build.

| # | Decision | Rationale / origin |
|---|----------|--------------------|
| D1 | **`cli-runner` sidecar is the isolation boundary.** CLIs never run in the `api` container. | Process env-stripping is insufficient — mounts are container-level; only a separate container excludes vault/db/secret mounts. |
| D2 | **API mounts NO CLI-data volumes.** `tools` + `auth/home` are `cli-runner`-only; transcripts are read by `cli-runner` and returned to the API via RPC `readNew`. | R4. Removes the inconsistent separate-transcripts-volume; the only api↔cli-runner coupling is the socket. |
| D3 | **Private RPC over a `0600` Unix socket on a shared volume mounted ONLY in `cli-runner` + `api`** (not `worker`, not `web`), **gated by a connection auth hello** (shared secret `JARVIS_CLI_RUNNER_RPC_SECRET`, excluded from the CLI env) because the socket is not private from same-UID CLI subprocesses. Verbs: `launch / submit / readNew / kill / isAlive` + non-session `listLiveSessions` + `probeProvider`. | R4 + v2 review. Least coupling; contract frozen in the RPC-contract doc. |
| D4 | **MCP tokens are API-owned.** Minted/tracked/revoked by the API's `SessionTokenRegistry`; `cli-runner` cannot revoke them. | R4. cli-runner is a passive consumer of the bearer; revocation authority stays with the token owner. |
| D5 | **API reconciles on `cli-runner` (re)connect AND on a server `bootId` change:** revoke tokens for sessions that no longer exist (sourced from `tokens.listSessionIds()`, so it works even with an empty `sessions` Map after an API restart), drop stale API sessions, and kill orphaned `jarv1s-live-*` sessions via RPC **by mux name** (the server kills/lists by canonical mux name, not only its Map). | R4 + v2 review. In-memory registry + crashable sidecar ⇒ need a deterministic restart reconciliation, not TTL drift. |
| D6 | **Root init service** (one-shot) `chown`s named volumes to `JARVIS_HOST_UID` before non-root services start; same-fs atomic promote for installs. | Non-root `api`/`worker`/`cli-runner` (uid `JARVIS_HOST_UID`) cannot own freshly-created named volumes themselves. |
| D7 | **Bundle tmux, not the CLIs.** The image ships tmux; provider CLIs are installed on-demand into the `tools` volume. Secrets never appear in tmux launch lines. | Keeps the image small + provider-agnostic; CLIs are user choice. |
| D8 | **`JARVIS_HOST_CLIS` removed in in-container mode.** `install.sh` stops writing it; it short-circuits before the PATH probe and masks container-installed CLIs (#341 superseded). | The host declaration is meaningless once CLIs live in the sidecar; presence comes from a sidecar PATH probe over RPC. |
| D9 | **`agy` pinning is required** — versioned artifact + pinned SHA512 + self-update disabled (or blocked). No mutable/`latest`/self-updating installs for any provider recipe. | Supply-chain: a third-party self-updating binary inside the trust-reduced sidecar is still a risk to bound. |
| D10 | **Provider state machine, persisted:** `not_installed → installing → installed → needs_login → ready → error`. | Onboarding + installer need a durable lifecycle, not a transient probe only. |
| D11 | **Hardened installer:** server-side allowlist recipes, pinned versions, **serialized per provider**, temp prefix on the **same fs** as `tools`, verify binary+version, **atomic symlink/rename promote**, rollback; concurrency-locked + idempotent. | Untrusted install paths (npm + curl-style script for `agy`) must be tamper-evident and crash-safe. |
| D12 | **Per-provider login smoke gate.** A provider is "supported" only after: login completes, token persists across a `cli-runner` restart, non-interactive auth works, and transcript format/path is verified. | "Installed" ≠ "works"; agy/Antigravity transcript shape is a spike risk vs the existing Gemini parser. |
| D13 | **Auth/billing is the CLI's concern** (BYO-provider). Jarv1s installs + orchestrates login but never holds provider billing/credentials beyond the `auth/home` volume the CLI itself writes. | ADR 0007 house model — the product never depends on Ben's server or proxies provider billing. |
| D14 | **ADR 0008 reversed by ADR 0010** (Phase 0 gate); embeddings explicitly scoped OUT of the reversal. | The topology shift (host-native → container-internal sidecar) is an ADR-level decision, not a spec detail. |

---

## 4. Architecture

### 4.1 Topology

```txt
                            ┌──────────────────────────────────────────────────────────┐
                            │ host (operator machine) — NO host tmux server required    │
                            │ NO ~/.claude / ~/.codex / ~/.gemini mounts (host bridge    │
                            │ DELETED). env.production.local is operator-owned (0600).   │
                            └──────────────────────────────────────────────────────────┘
                                                   docker compose -p jarv1s-prod
   ┌───────────────────────────────────────────────────────────────────────────────────────────┐
   │                                                                                             │
   │  ┌────────────┐   (one-shot, root)                                                          │
   │  │ init       │  chown tools+auth/home+socket vols → JARVIS_HOST_UID, then exit 0           │
   │  └─────┬──────┘                                                                             │
   │        │ all services depend_on init: completed_successfully                                │
   │        ▼                                                                                     │
   │  ┌──────────────────────┐        private 0600 Unix socket (rpc.sock)        ┌─────────────┐ │
   │  │ api  (uid HOST_UID)  │◀───────── socket volume (api + cli-runner ONLY) ──▶│ cli-runner  │ │
   │  │                      │  RPC: launch/submit/readNew/kill/isAlive            │(uid HOST_UID│ │
   │  │  ChatSessionManager  │  + reconcile(liveSessions) on (re)connect           │ SANITIZED   │ │
   │  │  SessionTokenRegistry│                                                     │ env — no    │ │
   │  │   (mint/verify/revoke│  ── MCP bearer over loopback HTTP /api/mcp ◀────────│ secrets/db/ │ │
   │  │    reconcile)        │     (cli-runner CLIs reach back with jst_ token)    │ vault)      │ │
   │  │                      │                                                     │             │ │
   │  │  mounts: vault, model│                                                     │  tmux server│ │
   │  │  cache, socket       │                                                     │  + claude / │ │
   │  │  (NO cli-data)       │                                                     │  codex/agy  │ │
   │  └─────────┬────────────┘                                                     │  installed  │ │
   │            │ same DB                                                          │  on-demand  │ │
   │  ┌─────────▼────────────┐   ┌──────────┐   ┌──────────┐                       │             │ │
   │  │ worker (uid HOST_UID)│   │ migrate  │   │ web/nginx│                       │ mounts:     │ │
   │  │ vault+cache; NO sock,│   │ one-shot │   │ no mounts│                       │  tools(RW)  │ │
   │  │ NO cli-data          │   └──────────┘   └──────────┘                       │  auth/home  │ │
   │  └──────────────────────┘                                                     │  (RW)       │ │
   │            │                                                                   │  socket(RW) │ │
   │  ┌─────────▼──────────┐                                                        └─────────────┘ │
   │  │ postgres (pgvector)│                                                                        │
   │  └────────────────────┘                                                                        │
   └───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 api ↔ cli-runner private-socket RPC

- **Transport:** a Unix-domain socket `rpc.sock` (mode `0600`, owner `JARVIS_HOST_UID`) on a named
  `socket` volume mounted **only** in `api` and `cli-runner`. No TCP, no network exposure.
- **Direction:** `api` is the RPC **client** (the `CliChatEngine` proxy); `cli-runner` is the RPC
  **server** holding the real engine impl + tmux + CLIs. `cli-runner` also drives an outbound
  **reconcile** notification to the API on (re)connect so the API can sweep its token registry.
- **Verbs (frozen — see RPC-contract doc for the authoritative shapes):** `launch(opts) → { offset }`
  (the post-drain transcript offset — CHANGED from `void`; the manager seeds `transcriptOffset` from it so
  the first `readNew` does not re-read the replay) · `submit(text) → void` ·
  `readNew(afterOffset) → { records, offset, complete }` · `isAlive() → boolean` · `kill() → void` ·
  plus two **non-session** verbs: `listLiveSessions() → { sessionKeys }` (reconciliation) and
  `probeProvider({ provider }) → OnboardingProviderCheckResponse` (onboarding, runs with NO token/replay).
  Sessions are keyed **by `actorUserId`**. The `launch` payload carries persona **content** (`personaText`)
  + the assembled **`replayBatch`** string + `mcpToken?` + `mcpServerUrl?` (NOT `neutralDir`/`personaPath`,
  which the API has no mount for); `TranscriptRecord` crosses as JSON; offsets are **UTF-16 code units of the
  JSONL string** (`jsonl.length`/`.slice`, matching `transcript-reader.ts`/`cli-chat-engine.ts` — NOT byte
  offsets), serialized as JSON numbers within JS safe-integer range.
- **Socket access control:** the `0600` socket is **not** private from same-UID CLI subprocesses, so the
  connection carries an **auth hello** with a shared secret `JARVIS_CLI_RUNNER_RPC_SECRET` (api +
  cli-runner-server env only; excluded from the CLI-subprocess env). Every response also carries a server
  **`bootId`** so the API detects a silent cli-runner fast-restart and reconciles. (Both frozen in the
  RPC-contract doc.)
- **Server-side-only state:** transcript file paths, the `neutralDir`, the persona file, the per-provider
  MCP-token files, and the multiplexer `MuxHandle` all live **only** in `cli-runner`; the API client never
  touches CLI disk. Persona is rendered **content** server-side from the API's `personaText` — the API sends
  no filesystem paths.
- **MCP bearer is a second, separate channel:** the CLIs reach the gateway over loopback HTTP
  (`/api/mcp`) with the `jst_` bearer — that is unchanged and is **not** the private socket.
- **Failure semantics:** if the socket is unreachable or the RPC server is down, the engine factory
  yields the existing `unavailableEngineFactory` behaviour → `CliChatUnavailableError` → HTTP 503,
  exactly as the in-process path does today. `not_launched` also maps to a **retryable 503**. Error payloads
  are redacted (see §5) and carry no stack. Raw RPC frames are **never** logged on either side (they carry
  the token + private conversation data); only `{ method, id, sessionKey, byte-length }` is loggable.

### 4.3 Volume / mount matrix

| Volume | Mount path | init | api | worker | web | cli-runner | Purpose |
|--------|-----------|:----:|:---:|:------:|:---:|:----------:|---------|
| `jarv1s-postgres-data` | `/var/lib/postgresql/data` | – | – | – | – | – | Postgres (postgres service only). |
| `jarv1s-vault-data` | `/data/vaults` | chown | RW | RW | – | – | Vault I/O (unchanged). |
| `jarv1s-model-cache` | `/app/.cache/huggingface` | chown | RW | RW | – | – | Embedding model cache (unchanged). |
| **`jarv1s-cli-tools`** | `/data/cli-tools` | chown | – | – | – | **RW** | Installed provider CLIs. `NPM_CONFIG_PREFIX=/data/cli-tools`; `PATH+=/data/cli-tools/bin`. |
| **`jarv1s-cli-auth`** | `/data/cli-auth` (`HOME`) | chown | – | – | – | **RW** | Provider auth tokens (`~/.claude`, `~/.codex`, `~/.agy`) **and** CLI session transcripts (`~/.claude/projects`, `~/.codex/sessions`, …). cli-runner reads transcripts here and returns them via RPC. |
| **`jarv1s-cli-socket`** | `/run/jarv1s` (`rpc.sock`) | chown + `0700` dir | **RW** | – | – | **RW** | The private RPC Unix socket. `0600` socket, `0700` dir. |

**Deletions from `infra/docker-compose.prod.yml`:** the host tmux-socket mount (`:162`), the three RO
host-CLI dir mounts (`:167-169`), and the shared neutral-dir mount (`:172`) — on **both** `api` and
`worker`. `JARVIS_CLI_HOME_BASE: /host-home` env on api/worker is removed; the sidecar's `HOME` is
`/data/cli-auth`.

**cli-runner env is stripped:** no `BETTER_AUTH_SECRET`, no `JARVIS_AI_SECRET_KEY`, no
`JARVIS_CONNECTOR_SECRET_KEY`, no DB URLs/passwords, no vault path. It carries only what it needs:
`HOME=/data/cli-auth`, `NPM_CONFIG_PREFIX=/data/cli-tools`, `PATH`, the RPC socket path,
`JARVIS_CLI_RUNNER_SINGLE_USER` (the single-active-user gate flag, default ON — §4.5 / RPC-contract §4.1.0a;
server config only, never in the CLI-subprocess env allowlist), and the loopback `mcpServerUrl` so launched
CLIs can reach `/api/mcp`. (The bearer token itself arrives per-launch via the RPC `mcpToken`, not via env.)

### 4.4 Token-ownership + reconciliation model

- **Ownership (D4):** the API's `SessionTokenRegistry` (`packages/ai/src/gateway/session-tokens.ts`)
  mints `jst_<uuid>` tokens (`:67`), keyed by `chatSessionId` (== `actorUserId` today), with a
  captured `allowedToolNames` allowlist and a 60-min sliding TTL backstop (`DEFAULT_TOKEN_TTL_MS`
  `:35`). It is **in-memory**. `cli-runner` receives the token at `launch` and uses it only as a
  bearer toward `/api/mcp`; it has **no** revoke capability.
- **Lifecycle (unchanged on the API side):** `ChatSessionManager` mints on launch, `touch`es per
  completed turn (sliding refresh), and revokes on `clear` / `switchProvider` / `reapIdle`.
- **Reconciliation (new — D5):** on every `cli-runner` (re)connect AND on a detected server `bootId`
  change, the API runs ONE reconcile pass (the authoritative routine is frozen in the RPC-contract doc §5.3):
  1. `listLiveSessions` → `liveKeys` (cli-runner enumerates real `jarv1s-live-*` mux sessions by name, not
     just its Map, so post-restart orphans are visible).
  2. **Revoke orphaned tokens — sourced from `tokens.listSessionIds()`** (NEW), not the `sessions` map:
     `reconcile(liveSessionIds: Set<string>)` (NEW) sweeps `this.tokens` and revokes every entry whose
     `chatSessionId` ∉ `liveKeys`, built on `revokeBySessionId` `:106`. This works even when the API's
     `sessions` map is empty (API restart) — the token registry is the source of truth.
  3. **Drop stale API sessions:** `sessions` keys ∉ `liveKeys` are dropped + their tokens revoked.
  4. **Kill orphaned multiplexer sessions:** `liveKeys` ∉ `sessions` are killed via RPC `kill` **by mux
     name** (the server can kill `jarv1s-live-<key>` with no Map entry).
  The manager hook `reconcileLiveSessions(liveKeys: Set<string>): Promise<void>` (NEW) performs 2–4 under a
  per-manager async mutex **shared with `reapIdle`** (they must not run concurrently); a key in the
  `launching` map is treated as live for the whole launch window. This makes a `cli-runner` (or API) crash
  recoverable without leaking a live token against a dead session and without leaving zombie tmux sessions
  holding a stale bearer.
- **Why not DB persistence:** out of scope for this phase (§2). The in-memory registry plus
  reconnect-reconciliation is the recovery mechanism; DB-backed tokens are a later milestone if
  horizontal API scaling is ever required.

### 4.5 Open security decision (ESCALATED — do NOT silently resolve)

> **Cross-session MCP-token-file isolation.** The per-session `0600` token files under `/data/cli-auth`
> (`.jarvis-claude-mcp.json`, `.jarvis-mcp-token.env`, `.gemini/settings.json`) remain **readable by any
> SAME-UID provider CLI subprocess** while a session is live (Codex finding #2): all CLIs run as the single
> `JARVIS_HOST_UID`, so one user's launched CLI could read another live session's token file. The socket
> auth secret (D3) closes **RPC** access; it does **not** close same-UID **file** access. Full per-user
> token isolation requires running the CLI subprocesses under **separate UIDs/identities (or per-user
> sidecars)** — a Lane-C/Lane-B infra + spawn concern that does **NOT** change the RPC contract.
>
> **Phase 1 ships same-UID + socket-secret + per-session-dir cleanup as a DOCUMENTED limitation, behind a
> HARD RUNTIME GATE.** The verdict on the escalation is **DEFER-OK-WITH-GATE** (tracking issue **#347**):
> UID/identity separation is deferred to fast-follow #347, **but only behind the single-active-user gate
> `JARVIS_CLI_RUNNER_SINGLE_USER` (default ON), which MUST land in Phase 1** (RPC-contract §4.1.0a; Lane B,
> in `cli-chat-engine.ts` §5.1). While the gate is ON the cli-runner holds at most one live engine, so no two
> sessions' `0600` token files are readable concurrently. The gate reuses the existing `unavailable` RPC
> code — **NO wire-contract change.**
>
> **INVARIANT:** Same-UID CLIs share a trust domain; per-session `0600` files are **NOT** a cross-user
> boundary — the single-active-user gate (`JARVIS_CLI_RUNNER_SINGLE_USER`, default ON) enforces isolation
> until UID-separation (issue **#347**) lands.
>
> **Tracking — issue #347** (security · milestone "Phase 2 · Multi-user" · Part of #47 · **BLOCKING** for
> concurrent multi-user CLI chat). **Lifting `JARVIS_CLI_RUNNER_SINGLE_USER` (enabling concurrent multi-user
> CLI chat) is gated on #347 closing.** (See ADR 0010 consequences + RPC-contract §4.1.0a / §13.)

---

## 5. Refactor surface (file-by-file, with line anchors)

Anchors are against `origin/main` `ff34061`. This is a **refactor that preserves the
security-critical command builders and the MCP token flow verbatim**; the new surface is the
socket boundary, the sidecar, and the secrets-out-of-launch-lines move.

### 5.1 `packages/chat/src/live/cli-chat-engine.ts` — split into proxy + server impl

- The existing `CliChatEngineImpl` (`launch :109-173`, `submit :175-178`, `readNew :180-283`,
  `isAlive :216-219`, `kill :221-230`) becomes the **server-side** engine running **inside
  `cli-runner`**. All disk + tmux + transcript-path resolution stays here (Claude pinned
  `--session-id` path; Codex/Gemini lazy `ls -t` glob + `findCodexTranscriptForCwd`).
- Add a new **client proxy** (e.g. `chat-engine-rpc-client.ts`) implementing the same
  `CliChatEngine` interface, marshalling each verb over the socket. The proxy holds **no** disk
  state; `readNew` returns `{ records, offset, complete }` decoded from JSON.
- **Secrets out of launch lines (plan step 6):** the Claude inline `--mcp-config` JSON
  (`buildClaudeCommand`, `:328` / `:331-343`) moves into a `0600` file `<neutralDir>/.jarvis-claude-mcp.json`
  whose **path** (not JSON) is passed on the launch line; Codex already writes a `0600`
  `.jarvis-mcp-token.env` (`:382-395`) and Gemini already writes `.gemini/settings.json` — keep both. **Use
  `0600` files ONLY — `tmux set-environment` is FORBIDDEN** (`tmux show-environment` is a capture surface;
  the v2 review rejected it — see the RPC-contract §6.2 and the ADR 0010 consequences note). The bearer
  never appears in the `tmux send-keys` line, process argv, `capture-pane`, `show-environment`, or logs.
  **Per-session cleanup (frozen):** cli-runner removes the **entire** per-session neutral dir on `kill` AND
  failed launch (one rule for all three providers' secret files — RPC-contract §6.5).
- **Preserve verbatim:** the constrained-launch flags for all three providers
  (Claude `--permission-mode default` + MCP-allowlist + `--strict-mcp-config`; Codex
  `--sandbox read-only -a never`; Gemini `--allowed-mcp-server-names jarvis`), `sanitizeInput`
  (leading-`!` strip), and `redactCause` (`:448-455`) redaction (`JARVIS_MCP_TOKEN=\S+`,
  `Bearer\s+\S+`, `jst_[A-Za-z0-9_-]+`).
- The class still derives `SESSION_PREFIX = jarv1s-live-*` (`:42`) for sessions; reconciliation
  (D5) matches on that prefix.
- **Single-active-user gate (Phase 1, until #347 — Lane B; RPC-contract §4.1.0a):** while UID-separation is
  absent, the cli-runner server holds **AT MOST ONE live engine** across all `sessionKey`s. A `launch` whose
  `sessionKey` differs from the currently-live `sessionKey` returns `RpcErr { code: 'unavailable' }`
  (redacted) until the live session is killed. Controlled by env flag `JARVIS_CLI_RUNNER_SINGLE_USER`
  (default `1` = ON; set `0` only when UID-separation #347 lands). This is an added error path that **REUSES
  the existing `unavailable` code — NO wire-contract change** — and is the HARD RUNTIME GATE standing in for
  the deferred UID separation (§4.5). It is **cli-runner-server config only** (not in the CLI-subprocess env
  allowlist). The per-session `0600` token files are readable by any same-UID CLI subprocess (§4.5), so the
  gate enforces isolation by ensuring only one session's secret files exist at a time until #347.

### 5.2 `packages/chat/src/live/runtime.ts` — factory wiring + `EngineLaunchOpts` extension

- `createRealEngineFactory` (`:54-61`) currently constructs an in-process `CliChatEngineImpl` with
  a real `TmuxIo` + `JARVIS_CLI_HOME_BASE` homeBase (read at `:58`). In-container mode constructs the
  **RPC client proxy** instead, pointed at the socket path (selected when `JARVIS_CLI_RUNNER_SOCKET` is set).
  **The env-var read at `:58` STAYS in code — the removal is compose-only.** On a host install the in-process
  path still reads `JARVIS_CLI_HOME_BASE`; only the compose `environment:` entry is dropped.
- **`EngineLaunchOpts` (`types.ts:21-28`) is extended additively** with optional `personaText?: string` +
  `replayBatch?: string` (all existing fields unchanged). The RPC client serializes `personaText` +
  `replayBatch` + `mcpToken` + `mcpServerUrl` + `provider` and drops `neutralDir`/`personaPath`; the
  in-process engine ignores the two new fields and keeps using the paths. `launch` now returns
  `Promise<{ offset: number }>` (the in-process engine returns `{ offset: 0 }`).
- Keep `engineFactory` injectable so integration tests still swap `FakeLiveEngine` (no socket, no
  CLI). The factory selection (in-process vs RPC-client) is env/config-gated so host-dev keeps the
  in-process path.

### 5.3 `packages/chat/src/live/chat-session-manager.ts` — reconciliation host + launch payload

- The per-user orchestration (`ensureSession`, replay, multi-tab fan-out, turn-at-a-time guard) stays **in
  the API process**, above the RPC boundary. Two targeted changes:
- **Populate the launch payload on BOTH paths.** `launchSession` (`:147`) now passes `personaText` (the
  rendered persona) + `replayBatch` (the assembled memory-seed + summary + recent-turns string, built from
  `:181-198`) into `engine.launch(...)` for **both** the in-process and RPC engines, and **seeds
  `session.transcriptOffset` from the returned `{ offset }`** (§4.2). For the RPC path the server runs
  submit+drain and returns the post-drain offset; for the in-process path the engine returns `{ offset: 0 }`
  and the manager keeps its own `submit`+drain (`:194-202`). **`personaText` + `replayBatch` are REBUILT on
  every launch** (initial, relaunch-after-reap, `switchProvider` `:302`, post-reconnect respawn) — never
  cached.
- **Add the reconcile entry point (D5):** `reconcileLiveSessions(liveKeys: Set<string>): Promise<void>`
  invoked on `cli-runner` (re)connect AND on a `bootId` change — calls the new
  `SessionTokenRegistry.reconcile(...)` (sourced from `listSessionIds()`), drops stale `sessions`, and issues
  RPC `kill` (by mux name) for orphaned `jarv1s-live-*` sessions. It runs under a **per-manager async mutex
  SHARED with `reapIdle`** (`:343`), and treats a `launching`-map key (`:110`) as live for the whole launch
  window. Wire its trigger at the socket-connect callback. **`reapIdle` has no production caller today** —
  this lane either wires it (an api `setInterval` sharing the mutex) or explicitly defers it (reconciliation
  works without it). 
- MCP lifecycle hooks (`mintMcpToken` on launch `:164`, `touchMcpToken` per turn, `revokeMcpToken` on
  clear `:292`/switch `:307`/reap `:349`) are unchanged in placement.

### 5.4 `packages/ai/src/gateway/session-tokens.ts` — add `listSessionIds` + `reconcile`

- Add `listSessionIds(): string[]` returning every distinct `identity.chatSessionId` currently holding a
  token. **This is the source for orphan-token revocation** — the `ChatSessionManager.sessions` map may be
  empty after an API restart, so the token registry (not the map) tells reconciliation which tokens exist.
- Add `reconcile(liveSessionIds: Set<string>): void` that iterates `this.tokens` and revokes every
  entry whose `identity.chatSessionId` ∉ `liveSessionIds`, reusing the existing delete path behind
  `revokeBySessionId` (`:106`). Mint (`:67`), verify, and the 60-min sliding TTL
  (`DEFAULT_TOKEN_TTL_MS` `:35`) are unchanged. Registry stays in-memory.

### 5.5 `infra/docker-compose.prod.yml` — sidecar + init + volumes; delete host bridge

- **Delete** the host bridge on `api` (`:162` tmux socket, `:167-169` RO CLI dirs, `:172` neutral
  dir) **and** the mirrored block on `worker` (`:192`/`:194-196`/`:197`); drop `JARVIS_CLI_HOME_BASE:
  /host-home` from both (`:137` api / `:185` worker). **This is a COMPOSE-only deletion — the code that reads
  `JARVIS_CLI_HOME_BASE`/`JARVIS_CHAT_HOME` stays (host-install path, §5.2).**
- **Set `JARVIS_CLI_RUNNER_RPC_SECRET`** (random) in the `api` AND `cli-runner` services' env (the socket
  auth secret, §4.2); `install.sh`/`env.production.example` generate it. **Excluded** from the CLI-subprocess
  env allowlist. Set `JARVIS_CLI_RUNNER_SOCKET` on both too.
- **Add `init`** (root, one-shot, `restart: "no"`): chowns `jarv1s-cli-tools`,
  `jarv1s-cli-auth`, `jarv1s-cli-socket`, `jarv1s-vault-data`, `jarv1s-model-cache` to
  `JARVIS_HOST_UID:JARVIS_HOST_GID` and creates `/run/jarv1s` `0700`. **Not** profile-gated (must run
  on a plain `up`); every other service gains `depends_on: init: { condition:
  service_completed_successfully }`.
- **Add `cli-runner`** (same image as `api`; `user: ${JARVIS_HOST_UID}:${JARVIS_HOST_GID}`):
  command = RPC server entrypoint; mounts `jarv1s-cli-tools:/data/cli-tools`,
  `jarv1s-cli-auth:/data/cli-auth`, `jarv1s-cli-socket:/run/jarv1s`; **sanitized env** (§4.3) —
  notably **no** `env_file` carrying app secrets, or an explicit minimal env block;
  `depends_on: init` + `migrate` not required (it touches no DB); `restart: unless-stopped`.
- **Add `socket` mount to `api`** (`jarv1s-cli-socket:/run/jarv1s`); do **not** add it to `worker`
  or `web`.
- **Add named volumes** `jarv1s-cli-tools`, `jarv1s-cli-auth`, `jarv1s-cli-socket` to the `volumes:`
  block.
- Preserve the existing env-file gotcha posture (`--env-file ./env.production.local` at `up` time;
  `POSTGRES_PASSWORD` via shell/flag interpolation only) — see the deployable-stack spec; do not
  regress it.

### 5.6 `install.sh` — stop writing `JARVIS_HOST_CLIS`

- The host-CLI detection loop (`:97` `command -v`) and the first-run append
  (`:187-202`, `printf 'JARVIS_HOST_CLIS=%s\n'`) are removed for in-container mode: `install.sh`
  no longer bakes a host-CLI declaration into `env.production.local`. (Phase 4 — after the sidecar
  PATH-probe path exists, so onboarding still reports presence.)

### 5.7 `packages/ai/src/cli-availability.ts` + onboarding probes — provider check over RPC (`probeProvider`)

- `declaredHostCliAvailable` (`:53-67`) and its `cliAvailable` short-circuit (`:78`) consult
  `JARVIS_HOST_CLIS` before the PATH probe. In in-container mode the env var is absent, so presence
  must come from the **new `probeProvider` RPC verb** (RPC-contract §4.8) — the api's
  `makeProviderConnectionCheckProbe` + `makeCliPresentProbe` call `probeProvider({ provider })` over the
  socket instead of spawning CLIs in-process (impossible once the binaries + auth live in cli-runner). **The
  live auth-status logic (claude/codex `auth status`, `agy --print`, PATH presence, multiplexer-usable)
  MOVES into cli-runner behind this verb**, runs with NO MCP token and NO replay, and returns the existing
  `OnboardingProviderCheckResponse` (incl. `multiplexer_unavailable`). Keep the host-mode `command -v` path
  intact behind the same function for native dev (the env-var read stays — compose-only removal).

### 5.8 No change required (confirm only)

- `packages/ai/src/gateway/gateway.ts` (tool chokepoint, allowlist enforcement) and
  `packages/chat/src/mcp-transport.ts` (`/api/mcp` bearer verify + rate-limit) — unchanged; the MCP
  bearer channel is orthogonal to the private socket.
- `packages/ai/src/adapters/transcript-reader.ts` (per-provider JSONL parsers) — unchanged; runs
  server-side in `cli-runner`. It slices the JSONL as a **JS string** (`jsonl.slice(afterOffset)`, `:86`),
  so the RPC offset is **UTF-16 code units**, not bytes — both sides must treat the transcript as a JS
  string (do NOT switch to byte offsets — RPC-contract §3.3). The agy/Antigravity transcript shape is a
  **Phase 3 spike**, not a change here.
- `packages/ai/src/adapters/multiplexer.ts` + `tmux-multiplexer.ts` — unchanged seam; the tmux
  server now forks **inside** `cli-runner` (no host socket).

---

## 6. Phasing

Phases land as separate PRs. The plan's parallel-lane / disjoint-file-ownership breakdown is locked
here so concurrent build agents don't collide.

### Phase 0 — spec + ADR (this document + ADR 0010) — **gate before any Phase 1 code**

- This master spec + the frozen RPC-contract doc + ADR 0010 (reverses 0008; scopes embeddings OUT;
  light-touch note on ADR 0003 that CLI transport now flows through the cli-runner RPC). Ben signs
  off before Phase 1 code.

### Phase 1 — in-container chat foundation (#342 core)

**CANONICAL DISJOINT LANE PARTITION (identical to the RPC-contract doc's lane table — no two lanes edit one
file).** The one cross-lane seam: **Lane A authors `rpc-contract.ts` FIRST**; Lanes B and D import it
read-only; Lane A's `runtime.ts` imports the engine class from Lane B's `cli-chat-engine.ts` (compile-time
only).

- **Lane A — api RPC client:** **NEW** `packages/chat/src/live/rpc-contract.ts` (**authored FIRST** — home of
  all wire types) · **NEW** `packages/chat/src/live/chat-engine-rpc-client.ts` (proxy implementing
  `CliChatEngine`; socket connect/reconnect; reconciliation driver) · `packages/chat/src/live/runtime.ts`
  (factory: socket present → rpc client, else in-process) · the `EngineLaunchOpts` extension in
  `packages/chat/src/live/types.ts`.
- **Lane B — cli-runner server:** **NEW** cli-runner server entrypoint/package ·
  `packages/chat/src/live/cli-chat-engine.ts` (server impl: Claude token off the launch line →
  `.jarvis-claude-mcp.json`; neutralDir derivation; per-session-dir cleanup; bounded launch-drain;
  `probeProvider` impl; kill-by-mux-name; listLiveSessions-by-mux). Imports `rpc-contract.ts`.
- **Lane C — infra:** `infra/docker-compose.prod.yml` (cli-runner + root-init services; tools/auth-home/socket
  volumes; **remove** host-bridge mounts `:162`/`:167-169`/`:172` + `JARVIS_CLI_HOME_BASE` env `:137`/`:185`;
  RPC-secret env) · Dockerfile/entrypoint · `install.sh` · `infra/env.production.example`.
- **Lane D — tokens + state + onboarding:** `packages/ai/src/gateway/session-tokens.ts`
  (`listSessionIds` + `reconcile`) · `packages/chat/src/live/chat-session-manager.ts`
  (`reconcileLiveSessions` + reconnect trigger + populate `personaText`/`replayBatch` + seed offset + reaper
  mutex) · `packages/shared/src/onboarding-api.ts` (additive `ProviderInstallState` + `installState?` DTO +
  JSON-schema block) · the Phase-2 `provider_state` migration. Imports `rpc-contract.ts`.

Outcome: chat works end-to-end with a **manually-installed** CLI in the `tools` volume (install
claude into `/data/cli-tools`, login, chat) — proves the foundation before any installer UI.

### Phase 2 — on-demand installer (hardened)

- Provider catalog (server-side allowlist recipes: claude → npm `@anthropic-ai/claude-code`;
  codex → npm `@openai/codex`; agy → versioned artifact + pinned SHA512, self-update disabled).
- Install service in `cli-runner`: serialized per provider, temp prefix on same fs as `tools`,
  verify binary+version, atomic symlink/rename promote, rollback, concurrency-locked, idempotent.
- Provider state machine persisted (D10) + the onboarding install step.

### Phase 3 — login presentation layer

- Login orchestration in `cli-runner`: run login in a captured tmux session, parse stdout for
  URL/device-code, surface to the UI, poll (claude/codex OAuth) or accept a pasted token; tokens
  land in `auth/home`.
- Per-provider smoke gate (D12): "supported" only after login completes, token persists across a
  `cli-runner` restart, non-interactive auth works, transcript format/path verified (agy spike vs
  the existing Gemini parser). Pin versions; self-update disabled.

### Phase 4 — polish

- Onboarding end-to-end integration; detection cleanup (delete `JARVIS_HOST_CLIS` handling in
  in-container mode — §5.6/§5.7; `install.sh` stops writing it); deploy docs; ADR 0010 landed.

---

## 7. Testing

- **Interface return-type change ripples to the fakes/suites.** `launch` now returns
  `Promise<{ offset }>`, so `FakeLiveEngine` (`tests/integration/chat-live-api.test.ts`) and the
  `cli-chat-engine` / `chat-session-manager` / `chat-live-api` suites **must be updated** to the new return
  type (the fakes return `{ offset: 0 }`; the manager seeds `transcriptOffset` from it). After that update
  they stay green. `FakeLiveEngine` is injected via `engineFactory` and never touches the socket.
- **Host-mode suites stay GREEN, unchanged** (the env-var removal is COMPOSE-only, not code — §5.2/§5.5):
  `tests/unit/cli-chat-engine.test.ts` (homeBase `'/host-home'`), `tests/unit/chat-live-chat-home.test.ts`
  (`JARVIS_CHAT_HOME`), `tests/unit/ai-cli-availability.test.ts` (`JARVIS_HOST_CLIS`). Other unchanged
  suites (`ai-tmux-bridge.test.ts`, `chat-multiplexer-usable.test.ts`) keep their mocked `TmuxIo`.
- **New — cli-runner RPC tests:** round-trip each verb (`launch / submit / readNew / kill /
  isAlive`) across an in-process socket pair; assert `readNew` marshals `{ records, offset,
  complete }` faithfully (UTF-16 code-unit offsets preserved, RPC-contract §3.3); assert the proxy surfaces
  `CliChatUnavailableError` → 503 when the socket is down; assert error payloads are redacted and
  stack-free.
- **Secrets-out-of-launch-lines:** assert the MCP bearer is **absent** from the tmux launch line, the
  spawned CLI argv (`/proc/<pid>/cmdline`), `tmux capture-pane`, `tmux show-environment` (enforces the
  no-`set-environment` rule), and api/server logs — for all three providers. Assert `kill` and a failed
  launch both remove the per-session neutral dir.
- **Socket auth hello:** assert a connection with a good `JARVIS_CLI_RUNNER_RPC_SECRET` proceeds and one
  with a bad/absent secret is closed; assert the CLI subprocess env carries neither the socket path nor the
  secret.
- **Token reconciliation:** unit-test `SessionTokenRegistry.reconcile(liveSet)` revokes only
  non-member tokens; integration-test that a `cli-runner` reconnect revokes the orphaned token and
  kills the orphaned `jarv1s-live-*` session.
- **Single-active-user gate (Lane B; RPC-contract §4.1.0a):**
  (a) **integration:** with `JARVIS_CLI_RUNNER_SINGLE_USER` ON (default) and one live session, a 2nd `launch`
      for a **different** `sessionKey` is rejected with `RpcErr code "unavailable"` while the first is live,
      and **succeeds after the first session is killed**.
  (b) **documenting test:** `0600` mode + `redactSecrets` do **NOT** protect a per-session token file from a
      **same-UID read** — so nobody mistakes `0600` for the cross-user boundary (the gate, not the file mode,
      enforces isolation until #347).
- **Installer (Phase 2):** serialized + idempotent install; atomic promote + rollback on a forced
  verify-failure; verify on amd64 **and** arm64 (Codex `optionalDependencies` regression risk).
- **Login smoke (Phase 3):** per-provider gate as in D12; token survives a sidecar restart.
- **Gate:** `pnpm verify:foundation` green; `pnpm check:file-size` (the engine split must keep each
  file < 1000 lines); `pnpm audit:release-hardening` for the deploy-ops surface. No new app
  migration is introduced by Phase 1 (code + infra only); the provider-state-machine persistence in
  Phase 2 adds its migration in the owning module's `sql/` dir (never `infra/`), and
  `foundation.test.ts`'s full-migration-list assertion is updated in the same PR.

---

## 8. Acceptance criteria (per phase)

**Phase 0**
- This spec + the RPC-contract doc + ADR 0010 exist; ADR 0010 reverses 0008, scopes embeddings OUT,
  and notes the ADR 0003 transport touch. Ben signs off.

**Phase 1**
- Host bridge fully removed from `infra/docker-compose.prod.yml` (api **and** worker): no host
  tmux-socket mount, no RO CLI-dir mounts, no shared neutral-dir mount, no `JARVIS_CLI_HOME_BASE` env
  (compose-only removal; the code that reads it for the host-install path stays).
- `init` (root) chowns the named volumes + creates the `0700` socket dir before non-root services
  start; all services `depend_on init: completed_successfully`.
- `cli-runner` runs with the sanitized env (no app secrets/db/vault) and **only** the tools +
  auth/home + socket mounts; `api` mounts the socket and **no** CLI-data volume; `worker`/`web`
  mount neither socket nor CLI data. `JARVIS_CLI_RUNNER_RPC_SECRET` is set on api + cli-runner and excluded
  from the CLI-subprocess env.
- The `api` `CliChatEngine` is a thin RPC client; the engine impl runs in `cli-runner`; the
  `CliChatEngine` interface changes ONLY `launch(): Promise<{ offset }>`; `FakeLiveEngine` + the listed
  suites are updated to the new return type and stay green; host-mode suites stay green unchanged.
- The connection auth hello authenticates the api (bad/absent `JARVIS_CLI_RUNNER_RPC_SECRET` ⇒ closed); a
  server `bootId` change triggers reconciliation.
- The MCP bearer is absent from tmux launch lines / argv (`/proc/<pid>/cmdline`) / `capture-pane` /
  `show-environment` / logs for all providers; `kill` and failed launch remove the per-session neutral dir.
- **Single-active-user gate lands (RPC-contract §4.1.0a, Lane B):** with `JARVIS_CLI_RUNNER_SINGLE_USER` ON
  (default) the cli-runner holds at most one live engine — a `launch` for a different `sessionKey` is rejected
  with `RpcErr code "unavailable"` while another session is live and succeeds after it is killed (test (a),
  §7); a documenting test (test (b), §7) shows `0600` + `redactSecrets` do not protect a per-session token
  file from a same-UID read. The gate reuses the existing `unavailable` code — no wire-contract change — and
  carries cross-user isolation until UID-separation (issue #347) lands.
- The API mints/owns/revokes MCP tokens; on `cli-runner` (re)connect AND on a `bootId` change the API
  revokes orphaned tokens (via `tokens.listSessionIds()`, even with an empty `sessions` map), drops stale
  sessions, and kills orphaned `jarv1s-live-*` sessions **by mux name**.
- `probeProvider` runs the onboarding provider check inside `cli-runner` (no token/replay); the api's
  onboarding probes call it over the socket.
- Chat works end-to-end with a manually-installed CLI; `pnpm verify:foundation` green.

**Phase 2**
- A user-selected provider installs on-demand into the `tools` volume via a server-side allowlist
  recipe; install is serialized, idempotent, atomic-promote + rollback on failure; binary+version
  verified; verified on amd64 + arm64.
- Provider state machine persists `not_installed → installing → installed → needs_login → ready →
  error`; onboarding surfaces an install step.

**Phase 3**
- Login runs in a captured tmux session; URL/device-code surfaces to the UI; tokens persist in
  `auth/home` across a `cli-runner` restart; non-interactive auth works.
- Each shipped provider passes the smoke gate (D12); agy ships only if its pin + transcript spike
  pass, else stays blocked.

**Phase 4**
- `install.sh` no longer writes `JARVIS_HOST_CLIS`; in-container CLI presence comes from the sidecar
  PATH probe over RPC; onboarding reports presence correctly with no tty error.
- Deploy docs updated; ADR 0010 landed; `pnpm audit:release-hardening` green.

---

## 9. Out of scope (restated)

GLM/opencode chat provider · on-demand mux choice (tmux bundled default) · API-key chat engine
(rejected) · host CLI login reuse (dropped) · Apple `container` as a *claimed* runtime (compatible
by design; deploy-docs follow-up) · uid-per-user OS isolation + non-operator attach +
privileged-launcher (deferred follow-on milestone) · embeddings containerization (stay in-process) ·
DB-backed token persistence / horizontal API scaling.

---

## 10. Risks / open questions (carried from the plan)

- **agy pinning spike** — versioned artifacts + checksums + self-update disablement from
  Antigravity? If unattainable, agy ships blocked (claude + codex first).
- **agy transcript/auth spike** — launch/auth/transcript shape vs the existing Gemini-shaped parser.
- **Codex optional-dep regressions** — verify install on amd64 **and** arm64.
- **ADR 0008 reversal regression** — confirm no standalone-embedder path breaks (embeddings stay
  in-process; ADR 0010 scopes this OUT explicitly).
- **In-memory token registry across API restart** — recovery is reconnect-reconciliation (§4.4),
  not persistence; DB-backed tokens are a later milestone only if horizontal scaling is needed.
- **`reapIdle()` scheduler** — the grounding flags that no production scheduler for `reapIdle()` is
  clearly wired; confirm/own its trigger so the 30-min idle reap (and its token revoke) actually
  fires in the deployed stack (tracked under Phase 1 token lane).
