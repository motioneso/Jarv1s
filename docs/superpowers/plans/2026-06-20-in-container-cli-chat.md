# Plan: In-container CLI chat (BYO-provider) — #342
_Locked via /grill-me-codex Act 1 — by GLM coordinator `ses_11cb3c6d` + Ben, 2026-06-20._
_R1(12)→R2(5)→R3(3)→R4(3) revised. Converging._

**Round-4 revisions (arbiter accepted all):** API mounts **NO CLI-data volumes** — `tools` + `auth/home` are cli-runner-only; CLIs write transcripts under `HOME` (= auth/home volume), and cli-runner returns transcript records to the API via the RPC `readNew` over the socket (cleanest isolation; removes the inconsistent separate-transcripts-volume). **MCP tokens are API-owned** — cli-runner can't revoke them; the API reconciles its token registry when cli-runner (re)connects and kills orphaned sessions via RPC. **Socket volume mounted ONLY in cli-runner + api** (not worker/web).

**Still in force:** cli-runner sidecar = isolation boundary; 3-way split effectively becomes tools + auth/home (cli-runner only) + private socket; root init service chowns volumes; same-fs atomic promote; Phase 0 = spec+ADR; secrets out of tmux launch lines; DELETE `JARVIS_HOST_CLIS` (#341 superseded); provider state machine; hardened installer (allowlist/pins/serialize/temp-prefix+verify+promote/rollback); per-provider login smoke gate; agy = Antigravity CLI (versioned+SHA512+self-update-disabled or blocked).

## Goal
Make live chat work in the containerized deploy (#342) by running the multiplexer **and** provider CLIs **inside a dedicated `cli-runner` sidecar container**, isolated from app secrets/vault/db. The user picks providers → Jarv1s installs the CLI on-demand → the user logs in via a presentation layer. Auth/billing is the CLI's concern, not Jarv1s's.

**MVP providers:** `claude` (`@anthropic-ai/claude-code`, npm), `codex` (`@openai/codex`, npm arch optionalDeps), `google` → **`agy`** = Antigravity CLI (versioned+SHA512+self-update-disabled; spike gated).

## Approach

**Phase 0 — spec + ADR (before code):**
0. Design spec (`docs/superpowers/specs/`) + ADR reversing ADR 0008. Ben approves before Phase 1 code.

**Phase 1 — in-container chat foundation (manual-install smoke; #342 core):**
1. **Drop the host bridge.** Remove host tmux-socket mount + read-only `~/.claude`/`~/.codex`/`~/.gemini` mounts from `infra/docker-compose.prod.yml`. Self-contained.
2. **`cli-runner` sidecar service** = isolation boundary. Runs tmux + CLIs with **only** the tools + auth/home volumes + sanitized env (no app secrets, vault, or db). Exposes a thin RPC — **launch / submit / readNew / kill / isAlive** — over a **Unix socket on a private shared volume (0600, mounted ONLY in cli-runner + api, not worker/web)**. The API's `CliChatEngine` becomes a thin socket client; **transcripts are read by cli-runner and returned via `readNew` — the API mounts NO CLI-data volumes.**
3. **In-container tmux + token/session reconciliation.** cli-runner's tmux forks its own server (no host socket). **MCP tokens are API-owned** (minted/tracked by the API's `mcpTokenLifecycle`); cli-runner cannot revoke them. On cli-runner (re)start/connect, the **API** reconciles its token registry (revokes tokens for dead sessions) and kills orphaned `jarv1s-live-*` sessions via the RPC.
4. **Root init/setup service** (one-shot, root) `chown`s the named volumes to `JARVIS_HOST_UID` before api/worker/cli-runner start (non-root).
5. **Volumes (least-privilege; API has NO CLI-data mounts):**
   - **tools** (`/data/cli-tools`, cli-runner RW, npm prefix): installed CLIs. `NPM_CONFIG_PREFIX=/data/cli-tools`; `PATH+=/data/cli-tools/bin`.
   - **auth/home** (`/data/cli-auth`, **cli-runner RW ONLY — not in api/worker/web**): provider auth tokens (`~/.claude`, `~/.codex`, `~/.agy` creds) AND CLI session transcripts (CLIs write under `HOME=/data/cli-auth`: `~/.claude/projects`, `~/.codex/sessions`, …). cli-runner reads these and returns records via RPC `readNew`.
   - **socket** (private shared volume, 0600, cli-runner + api ONLY): the RPC Unix socket.
   - cli-runner env stripped (no `BETTER_AUTH_SECRET`, `JARVIS_AI_SECRET_KEY`, db URLs, vault).
6. **Secrets out of launch lines.** Move the MCP bearer / codex config out of `cli-chat-engine.ts:328/357` tmux `send-keys` into **0600 files** or **tmux set-environment**. Tests assert token absence from `tmux capture-pane`, argv, logs.
7. **Manual-install smoke** via cli-runner (install claude into tools volume, login, chat). Proves the foundation before installer UI.

**Phase 2 — on-demand installer (hardened):**
8. **Provider catalog** — server-side allowlist recipes: claude → npm `@anthropic-ai/claude-code`; codex → npm `@openai/codex`; agy → **versioned Antigravity artifact + pinned SHA512, self-update disabled** (if unavailable, agy stays blocked/experimental). Pinned versions per recipe.
9. **Install service** (in cli-runner, sanitized). Serialized per-provider; temp prefix on SAME fs as tools; verify binary+version; **atomic symlink/rename promote**; rollback. Concurrency-locked; idempotent.
10. **Provider state machine** (persisted): `not_installed → installing → installed → needs_login → ready → error`.

**Phase 3 — login presentation layer:**
11. **Login orchestration** (in cli-runner): run login in a captured tmux session, parse stdout for URL/device-code, surface to UI, poll (claude/codex OAuth) or accept pasted token. Tokens land in the auth/home volume.
12. **Per-provider smoke gate** — "supported" only after smoke passes: login completes, token persists across restart, non-interactive auth works, transcript format/path verified (agy/Antigravity spike vs existing `~/.gemini` parser). Pin CLI versions; self-update disabled.

**Phase 4 — polish:** onboarding end-to-end integration; detection cleanup (delete `JARVIS_HOST_CLIS` handling in in-container mode — install.sh stops writing it); deploy docs; ADR landed.

## Key decisions & tradeoffs
- **cli-runner sidecar = isolation boundary**; CLIs never run in the api container (app secrets/vault/db). Process env-stripping is insufficient (mounts are container-level).
- **API has NO CLI-data mounts** — tools + auth/home are cli-runner-only; transcripts return via RPC `readNew`; the only api↔cli-runner coupling is the private 0600 socket (cli-runner+api only). (Codex R4.)
- **MCP tokens API-owned**; API reconciles on cli-runner (re)connect. (Codex R4.)
- **Bundle tmux, not CLIs.** Secrets never in tmux launch lines.
- **`JARVIS_HOST_CLIS` removed in in-container mode** (short-circuits before PATH, masks installed CLIs; #341 superseded).
- **agy pinning required** (no mutable/latest/self-updating installs).
- **Auth/billing is the CLI's concern.** Root init service for volume ownership.

## Risks / open questions
- **agy pinning spike** — versioned artifacts + checksums from Antigravity? self-update disablement? If not, agy blocked (ship claude+codex first).
- **agy transcript/auth spike** — verify launch/auth/transcript vs existing Gemini-shaped parser.
- **codex optional-dep regressions** — verify install on amd64 + arm64.
- **cli-runner RPC contract** — launch/submit/readNew/kill/isAlive over the 0600 Unix socket; keep minimal.
- **ADR 0008 reversal regression** — confirm no standalone-embedder path breaks.
- **Security** — third-party CLIs + curl|bash installer (agy); mitigated by sidecar isolation, allowlist, pins/checksums, self-update disabled, sanitized env, no secrets in launch lines, private socket, api reads no CLI data.

## Out of scope
- GLM / opencode chat provider (fast-follow). On-demand mux choice (tmux bundled default). API-key chat engine (rejected). Host CLI login reuse (dropped). Apple `container` as a supported runtime (compatible by design; deploy-docs follow-up — not claimed).

## Phasing (multiple PRs)
- **Phase 1:** cli-runner sidecar + root init + (tools/auth-home/socket) volumes + env wiring + secrets-out-of-launch-lines + private-socket RPC (incl readNew) + API-owned token reconciliation; chat works with a manually-installed CLI. (#342 core.)
- **Phase 2:** on-demand installer (npm + versioned-script recipes) + provider state machine + onboarding install step.
- **Phase 3:** login presentation layer + per-provider smoke gates.
- **Phase 4:** onboarding integration, detection cleanup, docs, ADR.
