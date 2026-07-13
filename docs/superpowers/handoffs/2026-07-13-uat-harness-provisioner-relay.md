# Relay — uat-harness-provisioner (#1024)

**Spec:** `docs/superpowers/specs/2026-07-12-dev-uat-harness.md` (§3 provisioning mechanics, §8.1
= Phase 1 scope). Only in the coordinator's own worktree (`coord/settings-host-cleanup` @
`04dc1996`) — read it there via absolute path, it's not on this branch.
**Handoff doc (original spawn):** `/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-coord-2026-06-30-rfa-fleet/58a78927-385c-4b1d-8fa0-94db20255d6f/scratchpad/handoff-uat-1024.md`
**Plan (approved-pending):** `docs/superpowers/plans/2026-07-13-uat-harness-provisioner.md` (committed `754f3d0a`)
**Branch/worktree:** `uat-harness-1024`, this worktree. Off `origin/main` @ `cdf66df0`.
**Coordinator:** Herdr label `Coordinator` (session `58a78927-385c-4b1d-8fa0-94db20255d6f`) —
resolve pane fresh by label at read time, never a baked `…-N`.
**Risk tier:** sensitive (dev-only privileged compose orchestration; no BYPASSRLS on runtime roles).

## State

Plan approval message sent to Coordinator (idle, `w1:pE6` at send time) verbatim:

> plan ready for uat-harness-provisioner: docs/superpowers/plans/2026-07-13-uat-harness-provisioner.md
> (tests/uat/provisioner.ts, 8 TDD tasks). Fork to flag: port allocation uses reserved range
> 20000-20099 + bind-probe (spec 3.4 option1), not spec's 'preferred' Docker-assigned-port option2
> -- avoids editing prod-shaped compose file for test convenience; subnet 10.254.0.0/24
> (dev=10.251, smoke=10.253). Rest follows spec 3/8.1 directly, no other drift on branch. Approve,
> or flag a fork.

Message delivered (input box empty on read-back). **No response yet as of this relay** — Coordinator
pane showed `3% until auto-compact` and its own goal-tracker busy with other items, so a reply may
be delayed. **Do NOT write any provisioner code until the Coordinator replies** (approve, or a fork
to resolve) — this is the hard gate per `coordinated-build` step 1.

## Next steps (in order)

1. **Check for the Coordinator's reply first.** `herdr pane read <coordinator-pane> --source recent
   --lines 30` (resolve pane fresh via `herdr pane list` + label `Coordinator`). Look for approval or
   a fork flag on the port-allocation deviation.
2. If **no reply yet**: do NOT idle-wait. It is fine to re-verify branch state / re-skim the plan by
   section while waiting, but do not start Task 1 code without approval. If genuinely stuck a long
   time, a polite re-ping is fine ("still waiting on plan approval for uat-harness-provisioner").
3. Once **approved**: execute the plan task-by-task via `superpowers:test-driven-development`
   (executing-plans/subagent-driven-development are disabled in this repo — drive inline). Read
   `docs/superpowers/plans/2026-07-13-uat-harness-provisioner.md` **by task section**, not
   front-to-back, to avoid burning context before writing code. Commit after each of the 8 tasks
   with the exact messages the plan specifies; stage only that task's files (never `git add -A`).
4. **Pre-push trio before every push:** `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
5. **Task 7** of the plan is a **live verification run** (real `docker compose` up/down against
   `infra/docker-compose.prod.yml`, reserved subnet `10.254.0.0/24`, ports `20000`–`20099`) — measure
   real wall-clock (locked decision: must record real numbers, not build the template-DB-clone
   optimization from spec §4.5, which is explicitly deferred).
6. **Task 8**: full `pnpm verify:foundation` gate, record exit codes, then invoke
   `coordinated-wrap-up` — PR against `main`, `Part of #1000` + `Closes #1024`, "What's new" note
   (say plainly it's dev-tooling, not user-visible), wall-clock + gate evidence in the PR body.
   Report the PR number to the `Coordinator` pane. **Do not merge** — tier sensitive, coordinator
   does QA + invariant walk first.

## Guardrails (repeat — hard, from original handoff)

- No `git add -A` / `git add .` — explicit paths only (shared working tree conventions habit).
- Do NOT touch `docs/coordination/` (coordinator-only), do NOT run repo-wide `pnpm format`.
- No new migration; don't touch `foundation-schema-catalog`.
- Any blocker or spec-unsettled decision → escalate to `Coordinator`, don't improvise.
- Generous why-comments in the actual code citing #1024/#1000 at non-obvious guards (port/subnet
  allocation, teardown trap, volume naming, privileged-connection seam — see plan Task 3's
  `SeedHook`/`bareSeedHook` for the "no BYPASSRLS on runtime roles" comment anchor).

## Relay trigger for this handoff

Context-meter hit 70% warning right after sending the plan-approval message (before any code
existed) — relaying per `coordinated-build` step 3 even though "zero progress past the plan" is a
known anti-pattern; judged the mechanical escalation send doesn't count as stalling since it was the
very next required action and took one tool call. Successor should move directly to checking for
the reply / building — no re-planning needed, the plan is done and committed.
