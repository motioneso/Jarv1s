# Relay 3 — #854 integration tests pollute shared dev DB

**Supersedes:** `2026-07-07-854-integration-test-db-isolation-relay-2.md` (research/design doc —
still fully accurate, no drift found; read it only if this doc is unclear about *why* a design
choice was made).
**Issue:** #854. **Spec:** none (bug fix, `routine` tier, coordinator confirmed no spec needed).
**Branch/worktree:** `854-integration-test-db-isolation`,
`/home/ben/Jarv1s/.claude/worktrees/854-integration-test-db-isolation` (this worktree — reuse it,
`node_modules` already present, skip `pnpm install`).
**Coordinator:** label `Coordinator` — **resolve session id fresh from `herdr pane list` every
time** (was `9fb2dc84-f605-4580-8ba3-510bbdef6f59` as of this relay — reconfirm, don't trust).
**Relay trigger:** context-meter 70% warning, fired immediately after plan approval, before any
code was written. Coordinator already notified (message sent, terse) — **already approved the
plan and said "proceed, message me when done or blocked."** No re-approval needed.

## Status: plan approved, ZERO code written, ZERO tasks started

- Plan doc (coordinator-approved): `docs/superpowers/plans/2026-07-07-854-integration-test-db-isolation.md`
  — committed at `81c7511d`. Read it IN FULL — it has complete code for all 6 tasks, exact file
  paths, exact test code, exact commands with expected output. This handoff doc does not
  re-summarize the plan; go straight to the plan file.
- Design premises in relay-2 were independently re-verified this session against branch HEAD
  before planning (root cause, `smoke-compose.ts` pattern, `urls.ts`, `test-database.ts`,
  `vitest.config.ts` `pool:"forks"`+`fileParallelism:false`, the exact list of 20 `package.json`
  `test:*` scripts to reroute, `test:memory:local`'s direct import of
  `resetEmptyFoundationDatabase`). No drift found — plan was written straight from the verified
  state, nothing stale to re-check.

## Next step (exact)

1. Read `docs/superpowers/plans/2026-07-07-854-integration-test-db-isolation.md` in full.
2. Resume via `coordinated-build` at step 2 (Build) — **plan approval already granted**, do not
   re-message the coordinator for plan approval, do not re-verify spec premises (done this
   session, noted above).
3. Execute Tasks 1-6 in order via `superpowers:test-driven-development`, each task ending in a
   green commit with the exact commit message given in the plan's "Commit" step, `git add` by the
   exact paths listed (never `-A`).
4. Self-monitor context per `coordinated-build` step 3 — relay again on the next 70% warning or
   compaction summary, same pattern as this relay.
5. Before any push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
6. On all 6 tasks green: `coordinated-wrap-up` — full gate (`pnpm verify:foundation`), push, open
   PR, report PR + Task 6's manual-smoke-test evidence (shared-DB-untouched diff, isolated-DB-drop
   confirmation, passthrough-mode confirmation) to the coordinator. Do not merge, touch the board,
   or close the issue — coordinator's job.

## Run-specific bans (still binding)

`git add` by explicit path only (never `-A`); never touch `docs/coordination/`, the board,
milestones, or merge; no secrets in any doc/payload/log; do not touch `packages/sports/*` or Park
Press/#780.
