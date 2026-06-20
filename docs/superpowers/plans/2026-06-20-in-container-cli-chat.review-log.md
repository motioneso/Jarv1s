# Plan Review Log: in-container CLI chat (#342)
Plan: `docs/superpowers/plans/2026-06-20-in-container-cli-chat.md`

Act 1 (grill) complete — plan locked with Ben. Resolved in the grill: in-container architecture (reverses ADR 0008); bundle tmux + on-demand npm-install CLIs; login in-container via presentation layer (solves macOS auth portability); auth/billing is the CLI's concern; onboarding-driven setup; MVP providers claude + codex + agy (Gemini CLI retired). MAX_ROUNDS=5.

## Round 1 — Codex (VERDICT: REVISE)
Grounded on origin/main ff34061. 12 findings, all accepted by the arbiter:
- HIGH: spec-before-build — plan lived only under plans/, needs approved spec + ADR 0008 reversal before code.
- HIGH: one volume for CLIs+auth+transcripts lets npm scripts/CLIs read provider tokens; api/worker also carry app env + vault. → split tools/auth volumes + stripped env + least mounts.
- HIGH: secrets in tmux launch lines (claude MCP bearer in argv/history; codex config interpolated at cli-chat-engine.ts:328/357). → 0600 files / tmux env.
- HIGH: agy not npm-installable (`npm view agy`=0.0.0, no bin); Gemini CLI retired → Antigravity CLI. → remove/block agy until verified.
- HIGH: code hardcodes `agy --sandbox` but transcript parser reads Gemini-shaped ~/.gemini JSONL. → real agy spike (launch/auth/transcript/paths).
- MED: JARVIS_CLI_HOME_BASE alone doesn't set HOME/npm-prefix/PATH/JARVIS_CHAT_HOME; chown needed.
- MED: "leave JARVIS_HOST_CLIS harmless" is FALSE — cliAvailable checks it before PATH (cli-availability.ts:76), masks in-container CLIs. → delete/ignore in in-container mode.
- MED: onboarding is presence-only (cliPresent); no install/auth state. → persisted state machine.
- MED: installer lacks supply-chain controls (allowlist/pins/registry-trust/lock/rollback/verify). → server-side allowlist, pins, serialize, temp-prefix+verify+atomic-promote.
- MED: login assumes device-code/stdout + no keychain — unverified. → per-provider container smoke gate.
- MED: 30-min reap won't clean orphaned jarv1s-live-* after crash/restart. → reconcile on startup + token rotation.
- LOW: Phase 1 doesn't need in-app installer — ship HOME/PATH wiring + manual `docker compose exec api npm i -g` smoke first.
External: @anthropic-ai/claude-code exists; @openai/codex exists w/ arch optionalDeps (regression reports); agy=0.0.0; Gemini CLI→Antigravity CLI (June 18 2026).

### Arbiter's response (revised PLAN.md)
All 12 accepted. Plan now: Phase 0 = spec + ADR (before code); split tools/auth volumes + stripped env; secrets out of launch lines; explicit env wiring + chown; DELETE JARVIS_HOST_CLIS in in-container mode (#341 superseded); provider state machine; hardened installer; per-provider login smoke gate; tmux orphan reconcile on startup; Phase 1 = manual-install smoke (no installer UI yet); google/agy BLOCKED pending Ben (agy distribution / Antigravity CLI / drop from MVP). [Ben resolved mid-round: agy = Antigravity CLI, installed via `curl -fsSL https://antigravity.google/cli/install.sh | bash` → script recipe.]

## Round 2 — Codex (VERDICT: REVISE; converging)
Most R1 findings addressed on paper. 5 refinements:
- R1#2 partial: launching tmux/CLI from the API container still exposes app env + vault mounts (container-level). → separate cli-runner sidecar service (only CLI volumes + sanitized env); API drives it via thin RPC.
- R1#6: chown underspecified (api non-root). → root init/setup service chowns volumes before services start.
- R1#9: atomic promote — temp prefix on SAME fs as tools volume; symlink/rename, not cross-volume move.
- R1#12: Phase 1 smoke must use the cli-runner path, not `docker compose exec api npm i -g`.
- NEW: Apple-`container` claim inconsistent with Docker-Compose-only plan. → drop the claim (out-of-scope only).

### Arbiter's response (revised PLAN.md)
All 5 accepted. Plan now: cli-runner sidecar = isolation boundary (no app secrets/vault/db); thin RPC seam (launch/submit/kill/isAlive) + shared auth/home volume for transcripts; root init service chowns volumes; atomic same-fs promote; Phase 1 smoke via cli-runner; Apple claim dropped to out-of-scope-only.

## Round 3 — Codex (VERDICT: REVISE; converging)
All 5 R2 refinements addressed. 3 new (finer security):
- HIGH: CLI auth + transcripts in one volume, mounted RW in API → API can read provider auth tokens. → split: auth volume RW cli-runner ONLY (not in api); transcript volume RO in api.
- HIGH: agy live installer pulls "latest" from mutable manifest + binary self-updates → contradicts pinned/reproducible. → versioned artifact + pinned SHA512 + self-update disabled, or agy blocked.
- MED: cli-runner RPC "HTTP over docker network or unix socket" is a privileged control plane (launches authenticated CLIs). → Unix socket on a private shared volume (0600, cli-runner+api only) or internal bearer scoped to api; no broad docker-network HTTP.

### Arbiter's response (revised PLAN.md)
All 3 accepted. Plan now: THREE volumes (tools / auth[cli-runner RW only] / transcripts[api RO]); RPC = Unix socket on private volume 0600 (not docker-network HTTP); agy requires versioned+checksummed artifact + self-update disabled or stays blocked.

## Round 4 — Codex (VERDICT: REVISE; very close)
All R3 addressed. 2 real + 1 minor:
- Split auth/transcript volumes: CLIs write transcripts under HOME (the auth dir), so a separate transcripts volume is inconsistent; api RO-mount of transcripts still couples api to CLI data. → simpler: cli-runner owns transcript reading, returns records via RPC readNew; api mounts NO CLI-data volumes.
- NEW MED: token lifecycle — cli-runner can't revoke API-owned in-memory MCP tokens. → API owns token registry; reconciles on cli-runner (re)connect + kills orphans via RPC.
- minor: socket volume mount only in cli-runner + api, not worker/web.

### Arbiter's response (revised PLAN.md)
All accepted. Plan now: api mounts NO CLI-data volumes (tools + auth/home cli-runner-only); transcripts return via RPC readNew over the private 0600 socket (cli-runner+api only); MCP tokens API-owned, API reconciles on cli-runner (re)connect.

## Round 5 — Codex (VERDICT: APPROVED) ✅
All Round-4 findings verified addressed (no api CLI-data mounts; transcripts via RPC readNew; API-owned token reconciliation; socket scoped to cli-runner+api). No remaining material blocker. Residual items correctly tracked as implementation gates: Antigravity pinning/self-update, agy transcript/auth spike, codex multi-arch, minimal socket RPC contract, ADR 0008 regression check. **Converged at round 5/5. → Resolution (Ben signoff).**
