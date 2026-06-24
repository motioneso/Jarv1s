# Coordination Run — 2026-06-24-chat-stability-batch

**Date:** 2026-06-24
**Coordinator lock:** label `Coordinator`, **stable anchor = session id `ses_111f40556ffeVraVZuie2X8ScJ`** (match `agent_session.value` in `herdr pane list`). Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this anchor holds authority for the life of the run. Pane numbers (`w…-N`) reflow — do NOT trust any pane number here; resolve fresh by label+session at read time. Agents escalate to the **label**; the coordinator merges only when its own pane's session id matches this anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; this run is all `routine`.
**Relay threshold:** security-tier merge → relay immediately; routine `merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary → relay, merge nothing.
**merges_since_relay:** 0

**CI mode (this run):** GitHub Actions billing is paused — `main` CI is red on billing, NOT code. **Local gate is the source of truth.** QA agents MUST run the full gate locally (`pnpm verify:foundation` / the pre-push trio `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest) — do NOT trust `gh pr checks` (it will show red from billing, not the PR). Record local-gate exit codes in the QA verdict.

**Run goal:** Batch 4 PRs that fix chat stability + ride a single combined docker image bump at the end. Task 3 (build + deploy + e2e verify) from `docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md` is **coordinator-owned** and runs AFTER all 4 PRs merge.

## Queue

| Spec | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md (Task 1) | — | routine | queued | — | — | chat-mcp-flag | — |
| docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md (Task 2) | — | routine | queued (serialized after Task 1) | — | — | chat-persona | — |
| #453 | #453 | routine | queued | — | — | embed-provider-cli-runner | — |
| #452 | #452 | routine | queued | — | — | install-sh-posix | — |

Risk tier (content triggers): all four are `routine` — no schema/auth/secret/RLS surface.
- Task 1: one feature-flag string in codex launch args.
- Task 2: persona string rewrite.
- #453: two env vars added to a compose service's `environment:` block.
- #452: shebang + array-to-positional rewrite in a host-side shell script.

## Dependency / merge order

- **Parallel group 1 (launch together):**
  - `chat-mcp-flag` (Task 1)
  - `embed-provider-cli-runner` (#453)
  - `install-sh-posix` (#452)
- **Serialized chain A:** `chat-mcp-flag` → `chat-persona` (Task 2 waits for Task 1 to merge). Reason: both touch `packages/chat/src/live/` and the persona test surface may assert engine launch behavior; landing Task 2 on top of Task 1 avoids a test-file merge conflict and lets Task 2's agent rebase onto the new flag.
- **Merge order:** `install-sh-posix` → `embed-provider-cli-runner` → `chat-mcp-flag` → `chat-persona`. (Any order among the parallel three is fine; chat-persona must land last in its chain.)
- **After all 4 merge:** coordinator runs Task 3 (tag, multi-arch image build, push GHCR, bump env tag, `docker compose up -d`, e2e verify per plan §Task 3).

## Collision notes

- `chat-mcp-flag` touches `packages/chat/src/live/cli-chat-engine.ts` + `tests/unit/cli-chat-engine.test.ts`.
- `chat-persona` touches `packages/chat/src/live/runtime.ts` + persona tests (`tests/unit/chat-live-persona.test.ts`, possibly `chat-live-manager.test.ts`). Serialized after `chat-mcp-flag` to avoid test-file collision.
- `embed-provider-cli-runner` touches `infra/docker-compose.prod.yml` only (cli-runner service env block, ~L266).
- `install-sh-posix` touches `install.sh` only.
- No file overlap between the parallel three. No shared-table migrations. No migration numbers in play.

## CI waivers

Local-gate mode (see CI mode note above). `gh pr checks` is expected red on billing for the whole run — this is NOT a waiver, it is a known-inapplicable signal. QA trusts local gate exit codes, recorded in each verdict.

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | -------------------------- | ----- | ------------ |
| (n/a — local-gate mode) | — | — | — | — |

## Outstanding escalations

- [ ] (none)

## Reaped sessions

- (none yet)

## Notes for successor / relay

- Run ID: `2026-06-24-chat-stability-batch`. Manifest: this file.
- Plan: `docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md`. Tasks 1+2 are build-agent work; Task 3 is coordinator-owned and fires after the 4 PRs merge.
- CI billing is the ONLY reason `main` looks red. Do not treat it as a code failure. Do not try to "fix CI" — it is an account billing issue outside the repo.
- After Task 3 lands, save durable memory for: the `tool_call_mcp_elicitation=false` fix, the persona rewrite, and the local-gate-mode decision.
