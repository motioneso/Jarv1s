# Build Handoff — external worker capabilities (#915, remaining scope)

**Spec (approved, on main):** docs/superpowers/specs/2026-07-09-external-worker-capabilities-design.md
(rev2, merged via PR #922 — the `needs-spec` label on the issue is STALE, ignore it).
**GitHub issue:** #915
**Risk tier:** `security` — network-exposed host-pinned fetch (SSRF surface), pg-boss queue/schedule
registration, credential-adjacent worker capabilities, metadata-only-payload invariant. This PR gets
adversarial Opus QA + Fable merge sign-off — build to that bar (prove trust boundaries, no secret
escape, RLS holds).
**Worktree:** ~/Jarv1s/.claude/worktrees/915-worker-capabilities **Branch:** feat/915-worker-capabilities (off origin/main @ ff2ab3a7).
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md (follow this exact
file if `coordinated-build` does not resolve by name in your spawn env).
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label (resolve fresh; never a cached `…-N`).
**Coordinator session id:** `58a78927-385c-4b1d-8fa0-94db20255d6f` (immutable authority; label is routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store).
2. Read the spec above BY SECTION for your current task only — never front-to-back in one pass. A
   full-read bloats a fresh context toward the relay threshold before you write any code. Reading is
   not progress: BUILD, commit per task, relay only past ~80%.
3. Invoke **`coordinated-build`** and follow it end-to-end: verify the spec against your actual branch
   → plan (`superpowers:writing-plans`) → coordinator approval (do NOT write code before it) → TDD
   build → **`coordinated-wrap-up`** (PR + report). Escalation rules, gate commands, and caveman-mode
   comms are all defined there.

## SCOPE — remaining #915 only (read this carefully)

The spec has THREE goals. **Goal #2 (provider-agnostic structured-AI RPC / `ctx.ai.generateStructured`)
is ALREADY SHIPPED via PR #923 (merged 2026-07-10)** — the `packages/ai` structured adapter + tests
are on main. **Do NOT re-implement it.** When you verify the spec against the branch (coordinated-build
step ½), you will find Goal #2 already present — that is expected; exclude it.

**Your scope is Goal #1 + Goal #3:**
- **Goal #1 — queue/worker registration + schedule reconciliation.** Module manifest declares pg-boss
  queues + recurring schedules; platform registers workers dispatching into the module child process,
  reconciles per-user schedules on startup + enablement changes, exposes a run-now enqueue seam.
- **Goal #3 — host-pinned fetch** runtime capability (mediated by the trusted parent; SSRF-safe —
  this is the security crux, see the v0.1.0 audit's web.read SSRF finding for the bar).
- Generic contracts only: no consumer-specific queue names, prompts, or hosts in core.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide `pnpm format`.
- Never touch `docs/coordination/` beyond READING this handoff (coordinator-only), the project board,
  milestones, or merge.
- No secrets in any doc, payload, log, or prompt. Metadata-only pg-boss payloads (actor/resource IDs,
  job kind, idempotency key, small params) — never private content/prompts/secrets.

## Collision notes (from the coordinator)

- **#919 (worker runtime, child-process JSON-RPC) IS NOW ON MAIN** (migration 0157, PR #939 squash
  `ff2ab3a7`). Build ON it — the child-process transport, `set_config('app.current_module_id')` module
  isolation, and the NOBYPASSRLS `jarvis_worker_runtime` role already exist. Extend, don't duplicate.
- **Migration numbers:** main tops at **0157**. If you need a migration, do NOT assume a number —
  message the coordinator; landing order is assigned (next free is 0158, but confirm — other lanes may
  land first). Foundation.test.ts `toEqual` asserts the FULL ordered migration list — add your row.
- pg-boss client lives in `packages/jobs/src/pg-boss.ts` (`createPgBossClient`, `getAllQueueDefinitions`,
  `boss.work` is process-local — the spec's "Current state" section documents the exact seams to extend).
