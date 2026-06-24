# Coordination Run — 2026-06-24-chat-stability-batch

**Date:** 2026-06-24
**Coordinator lock:** label `Coordinator`, **stable anchor = session id `ses_111f40556ffeVraVZuie2X8ScJ`** (match `agent_session.value` in `herdr pane list`). Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this anchor holds authority for the life of the run. Pane numbers (`w…-N`) reflow — do NOT trust any pane number here; resolve fresh by label+session at read time. Agents escalate to the **label**; the coordinator merges only when its own pane's session id matches this anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; this run is all `routine`.
**Relay threshold:** security-tier merge → relay immediately; routine `merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary → relay, merge nothing.
**merges_since_relay:** 0

**CI mode (this run):** GitHub Actions billing is paused — `main` CI is red on billing, NOT code. **Local gate is the source of truth.** QA agents MUST run the full gate locally (`pnpm verify:foundation` / the pre-push trio `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest) — do NOT trust `gh pr checks` (it will show red from billing, not the PR). Record local-gate exit codes in the QA verdict.

**Run goal:** Batch 6 PRs that fix chat stability + clear small follow-ups, all riding a single combined docker image bump at the end. Task 3 (build + deploy + e2e verify) from `docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md` is **coordinator-owned** and runs AFTER all 6 PRs merge.

## Queue

| Spec | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md (Task 1) | — | routine | pr-open (push-approved) | glm · chat-mcp-flag | w1:pJ | chat-mcp-flag | (pending push) |
| docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md (Task 2) | — | routine | queued (serialized after Task 1) | — | — | chat-persona | — |
| #453 | #453 | routine | building | gemini · embed-provider-cli-runner | w1:pK | embed-provider-cli-runner | — |
| #452 | #452 | routine | pr-open | glm · install-sh-posix | w1:pM | install-sh-posix | #459 |
| #444 | #444 | sensitive | pr-open | gemini · data-export-cleanup | w1:pN | data-export-cleanup | #462 |
| #448 | #448 | routine | pr-open | glm · web-search-key-observability | w1:pP | web-search-key-observability | #461 |

**Agents tab:** w1:tB (label "Agents"). 5-pane grid: w1:pJ, w1:pK, w1:pM, w1:pN, w1:pP.

Risk tier (content triggers):
- Task 1: routine — one feature-flag string in codex launch args.
- Task 2: routine — persona string rewrite.
- #453: routine — two env vars added to a compose service's `environment:` block.
- #452: routine — shebang + array-to-positional rewrite in a host-side shell script.
- #444: **sensitive** — touches the data-export path (export/delete). Three defects: vault-file cleanup sweep on expiry, `completed_at = now()` fix, wrap initial status update in try/catch. Gets standard QA + explicit invariant check (VaultContext usage, metadata-only payloads, no secret leakage on the cleanup path).
- #448: routine — logging seam for undecryptable Brave key + dedup `assertAdmin` helper reuse.

## Dependency / merge order

- **Parallel group 1 (launch together):**
  - `chat-mcp-flag` (Task 1)
  - `embed-provider-cli-runner` (#453)
  - `install-sh-posix` (#452)
  - `data-export-cleanup` (#444)
  - `web-search-key-observability` (#448)
- **Serialized chain A:** `chat-mcp-flag` → `chat-persona` (Task 2 waits for Task 1 to merge). Reason: both touch `packages/chat/src/live/` and the persona test surface may assert engine launch behavior; landing Task 2 on top of Task 1 avoids a test-file merge conflict and lets Task 2's agent rebase onto the new flag.
- **Merge order:** any order among the parallel five; `chat-persona` lands last in its chain (after `chat-mcp-flag`).
- **After all 6 merge:** coordinator runs Task 3 (tag, multi-arch image build, push GHCR, bump env tag, `docker compose up -d`, e2e verify per plan §Task 3).

## Collision notes

- `chat-mcp-flag` touches `packages/chat/src/live/cli-chat-engine.ts` + `tests/unit/cli-chat-engine.test.ts`.
- `chat-persona` touches `packages/chat/src/live/runtime.ts` + persona tests (`tests/unit/chat-live-persona.test.ts`, possibly `chat-live-manager.test.ts`). Serialized after `chat-mcp-flag` to avoid test-file collision.
- `embed-provider-cli-runner` touches `infra/docker-compose.prod.yml` only (cli-runner service env block, ~L266).
- `install-sh-posix` touches `install.sh` only.
- `data-export-cleanup` (#444) touches the data-export module (vault cleanup + job status) — verify exact files at plan time; expected `packages/vault/` + `packages/db/` job-handling code. Uses `VaultContext` only.
- `web-search-key-observability` (#448) touches `packages/web-research/src/providers.ts` + `packages/settings/src/web-search-key-routes.ts` + composition root for logger threading.
- No file overlap between any parallel lane. No shared-table migrations. No migration numbers in play.

## CI waivers

Local-gate mode (see CI mode note above). `gh pr checks` is expected red on billing for the whole run — this is NOT a waiver, it is a known-inapplicable signal. QA trusts local gate exit codes, recorded in each verdict.

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | -------------------------- | ----- | ------------ |
| `pnpm lint` (repo-wide) | all lanes | `202c638b` (origin/main) | `tests/unit/chat-live-manager.test.ts:92` 'NeverCompletingEngine' unused — coordinator ran `pnpm lint` against origin/main content; 1 error, 0 warnings. Not any lane's file. | y (2026-06-24, local-gate-mode standing approval) |
| `pnpm format:check` (repo-wide) | all lanes | `202c638b` (origin/main) | warns on `docs/superpowers/plans/2026-06-24-prod-codex-provider-onboarding.md` + `docs/.../2026-06-24-chat-stability-notes-memory.md` + `CLAUDE.md` (coordinator edit) — none are any lane's code file. | y (2026-06-24, local-gate-mode standing approval) |

**Push policy this run:** lanes push when their OWN lane-files pass format+lint+typecheck+vitest individually, even if repo-wide format/lint is red from pre-existing origin/main breakage (proven + recorded above). QA agents re-verify per-PR on the PR branch.

## Outstanding escalations

- [ ] (none)

## Reaped sessions

- (none yet)

## Notes for successor / relay

- Run ID: `2026-06-24-chat-stability-batch`. Manifest: this file.
- Plan: `docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md`. Tasks 1+2 are build-agent work; Task 3 is coordinator-owned and fires after the 4 PRs merge.
- CI billing is the ONLY reason `main` looks red. Do not treat it as a code failure. Do not try to "fix CI" — it is an account billing issue outside the repo.
- After Task 3 lands, save durable memory for: the `tool_call_mcp_elicitation=false` fix, the persona rewrite, and the local-gate-mode decision.
