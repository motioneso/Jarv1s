# 0010 — Chat engine: in-container CLI runner sidecar (isolation boundary)

**Status:** accepted (2026-06-20). **Supersedes** ADR 0008's host-native CLI topology;
**preserves** its pluggable-adapter + provider-agnostic intent. **Evolves** ADR 0003 (_interactive
chat is CLI transport_ — the transport now flows through cli-runner RPC, same principle).
**Context:** ADR 0008 made the chat engine a pluggable adapter and chose **onboarding-provisioning
on the target host** — the CLI binaries and the user's auth live on the host, mounted into the
`api`/`worker` containers (host tmux socket + read-only `~/.claude`/`~/.codex`/`~/.gemini` + a shared
chat home). That topology welds the deploy to a host that already runs the CLIs and tmux, and it
mounts CLI credentials and provider auth **into the app container that also holds `BETTER_AUTH_SECRET`,
`JARVIS_AI_SECRET_KEY`, the vault, and the database** — a secrets/volume-leakage surface flagged for
the containerized deploy (#342). Process-level env-stripping is insufficient because mounts are a
container-level grant. We need the CLIs to run **inside the deployable stack**, isolated from app
secrets, with the user installing/authing their own provider on demand. This is a topology decision
at the ADR level, not a spec detail.

## Decision

1. **The `cli-runner` sidecar container is the isolation boundary.** All provider CLIs and the
   multiplexer (tmux) run **only** inside a dedicated `cli-runner` service, never in `api`/`worker`.
   It receives **only** the CLI-data volumes (tools + auth/home) plus a sanitized env — no
   `BETTER_AUTH_SECRET`, no `JARVIS_AI_SECRET_KEY`, no database URLs, no vault. The adapter/router
   intent of ADR 0008 is unchanged: the chat engine is still a pluggable adapter behind the
   capability router, provider-agnostic and per-instance-selectable; only the _execution locus_ moves
   from the host into a sidecar.

2. **`api`/`worker` mount NO CLI-data volumes.** The tools and auth/home volumes are **cli-runner-only**.
   The API's `CliChatEngine` becomes a thin RPC client; it never touches CLI binaries, provider auth,
   or transcript files on disk. The only `api`↔`cli-runner` coupling is the private RPC socket.

3. **Transcripts are read by cli-runner and returned over a private Unix-socket RPC.** cli-runner
   exposes a minimal contract — **launch / submit / readNew / kill / isAlive** plus two non-session verbs
   (**listLiveSessions** for reconciliation, **probeProvider** for onboarding) — over a Unix socket on
   a private shared volume, **mode `0600`, mounted ONLY in `cli-runner` + `api`** (not `worker`/`web`).
   Because the `0600` socket is **not** private from same-UID CLI subprocesses, each connection is gated by
   an **auth hello** carrying a shared secret (`JARVIS_CLI_RUNNER_RPC_SECRET`, api + cli-runner-server env
   only, excluded from the CLI env), and every response carries a server `bootId` so the API detects a silent
   fast-restart. CLIs write transcripts under `HOME` (= the auth/home volume); cli-runner reads them and
   returns `TranscriptRecord`s to the API via `readNew`. The CLI's `~/.claude`/`~/.codex`/`~/.agy` auth
   tokens and session transcripts never leave the sidecar.

4. **MCP tokens stay API-owned and are reconciled on cli-runner reconnect.** The API mints, tracks,
   and revokes session tokens (`mcpTokenLifecycle`); cli-runner is a passive consumer that cannot
   revoke them. When cli-runner (re)starts/connects, the **API** reconciles its token registry —
   revoking tokens for dead sessions and killing orphaned `jarv1s-live-*` multiplexer sessions via the
   RPC — so a sidecar crash cannot strand a live token against a dead session.

5. **Secrets never appear in tmux launch lines.** The MCP bearer / provider config moves out of
   `send-keys` launch lines into per-session `0600` files **only**. **`tmux set-environment` is NOT used**
   (the v2 contract review rejected it: `tmux show-environment` is a capture surface that would re-expose the
   token). Tests assert token absence from the launch line, argv (`/proc/<pid>/cmdline`), `tmux
capture-pane`, `tmux show-environment`, and logs.

6. **A root one-shot init service owns volume permissions.** It `chown`s the named volumes to
   `JARVIS_HOST_UID` before `api`/`worker`/`cli-runner` start non-root; all those services
   `depends_on` it completing successfully.

7. **CLIs are installed on demand by a hardened installer inside cli-runner.** A server-side
   **allowlist** of provider recipes (claude → npm `@anthropic-ai/claude-code`; codex → npm
   `@openai/codex`; google → **`agy`** = Antigravity CLI) with **pinned versions**. Install is
   serialized per-provider, written to a temp prefix on the **same filesystem** as the tools volume,
   verified (binary + version), then **atomically promoted** by symlink/rename, with **rollback** on
   failure. Concurrency-locked and idempotent. `JARVIS_HOST_CLIS` (the host-CLI declaration from #341)
   is removed in in-container mode — it short-circuits before the PATH probe and would mask the
   container-installed CLIs.

8. **`agy` is version-pinned, checksum-verified, and self-update-disabled.** The Antigravity recipe
   uses a versioned artifact + pinned **SHA512** with self-update disabled (or blocked outright); no
   mutable/`latest`/self-updating install is permitted. If a safe pinned artifact is unavailable, `agy`
   stays blocked/experimental and we ship claude + codex first.

## Consequences

- **Embeddings are explicitly OUT of scope and unchanged.** This ADR moves only the CLI _chat_ engine
  into a sidecar. The M-A1 embedding stack — `LocalEmbeddingProvider` (nomic-embed-text-v1.5) loaded
  **in-process** in the API/worker via `@huggingface/transformers` — is untouched: no standalone
  embedder is created, required, or foreclosed. This closes the "standalone-embedder regression" risk
  named in the plan: containerizing the CLIs neither couples embeddings to the chat sidecar nor forces
  embeddings out of process; a future standalone-embedder path remains open as an independent decision.
- ADR 0008's **adapter/router + provider-agnostic + per-instance-choice** decisions remain in force;
  only its **§2 host-native provisioning** (host CLI binaries + host-mounted auth) is superseded.
  Portability still holds — provider choice is still selectable per instance — but "provision on the
  target host" becomes **on-demand provisioning inside the cli-runner container**.
- ADR 0003's "CLI is the transport" — already narrowed by 0008 to "CLI is _one_ adapter" — now flows
  through the cli-runner RPC rather than a host tmux socket. Same transport principle; 0003 is not
  rewritten.
- The host-bridge mounts (host tmux socket + read-only `~/.claude`/`~/.codex`/`~/.gemini` + shared
  chat home) are **removed** from `infra/docker-compose.prod.yml`; the deploy becomes self-contained.
- The chat engine splits into a server-side implementation (in cli-runner) and a client-side RPC proxy
  (in `api`) behind the unchanged `CliChatEngine` interface, so existing engine/manager tests and the
  `FakeLiveEngine` stub stay valid.
- Onboarding gains an **install + login presentation layer** (provider state machine
  `not_installed → installing → installed → needs_login → ready → error`; per-provider smoke gate) —
  a build-out, not a rearchitecture.
- **Token-to-CLI delivery is `0600`-file-only; `tmux set-environment` is explicitly rejected** (v2
  contract review). `tmux show-environment` can dump the session environment, so a token placed there would
  be exfiltratable by any same-server reader — the per-session `0600` file is the only delivery channel.
- **Cross-session MCP-token-file isolation — deferred to #347 behind a HARD RUNTIME GATE
  (DEFER-OK-WITH-GATE).** The per-session `0600` token files under `/data/cli-auth` remain **readable by any
  SAME-UID provider CLI subprocess** while a session is live (Codex finding #2) — all CLIs run as the single
  `JARVIS_HOST_UID`. The socket auth secret (decision §3) closes RPC access; it does **not** close same-UID
  file access. Full per-user token isolation requires running CLI subprocesses under **separate
  UIDs/identities (or per-user sidecars)** — an infra + spawn concern that does NOT change the RPC contract.
  **Phase 1 ships same-UID + socket-secret + per-session-dir cleanup as a documented limitation, gated by the
  single-active-user gate `JARVIS_CLI_RUNNER_SINGLE_USER` (default ON), which MUST land in Phase 1**
  (RPC-contract §4.1.0a / §13): while ON, the cli-runner holds at most one live engine, so no two sessions'
  `0600` token files are readable concurrently. The gate reuses the existing `unavailable` RPC code — no
  wire-contract change.
  - **INVARIANT:** Same-UID CLIs share a trust domain; per-session `0600` files are **NOT** a cross-user
    boundary — the single-active-user gate (`JARVIS_CLI_RUNNER_SINGLE_USER`, default ON) enforces isolation
    until UID-separation (issue **#347**) lands.
  - **Tracking — issue #347** (security · milestone "Phase 2 · Multi-user" · Part of #47 · **BLOCKING** for
    concurrent multi-user CLI chat): defer UID/identity separation for the CLI subprocesses. **Lifting
    `JARVIS_CLI_RUNNER_SINGLE_USER` (enabling concurrent multi-user CLI chat) is gated on #347 closing.**
- A `PreToolUse` policy and DB-persisted token store remain **deferred** to a separate
  security-hardening decision; out of scope for this container-topology change.
