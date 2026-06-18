# Build Handoff — owner-bootstrap-recovery-260

**Spec (approved):** `docs/superpowers/specs/2026-06-18-owner-bootstrap-recovery.md`  
**GitHub issue:** #260  
**Risk tier:** `security` (first owner/admin privilege assignment)  
**Worktree:** `~/Jarv1s/.claude/worktrees/owner-bootstrap-260`  
**Branch:** `owner-bootstrap-260`  
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`  
**Coordinator label:** `Coordinator`  
**Coordinator session id:** `019edba6-76f5-7d13-9de9-2b5a8b4e5d1f`  
**Relay threshold:** countable events — about 80-100k tokens or a compaction summary in your own
context.

## Start

1. Resolve your skills. Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute build skill path above and follow it directly.
2. `[ -d node_modules ] || pnpm install`.
3. Read `CLAUDE.md`, the approved spec above, and this handoff IN FULL.
4. Invoke/follow the `coordinated-build` skill: write a plan first, escalate it to `Coordinator`
   for approval, then build only after approval.

## Current State

- Ben approved the simplified #260 rule on 2026-06-18:
  if no owner/bootstrap owner exists, the signup gets onboarding and becomes owner/admin without
  pending approval.
- Do not include the earlier optional operator CLI escape hatch in this slice. It is out of scope
  unless the coordinator explicitly expands scope.
- Current relevant code is in `packages/auth/src/index.ts`, especially `bootstrapFirstJarvisUser`.
- Existing integration coverage lives in `tests/integration/auth-settings.test.ts`.
- GitHub Actions is billing-blocked. Use local gate evidence; coordinator will run independent QA
  before merge.

## Scope

Build the approved #260 owner-bootstrap recovery behavior:

- Replace the literal `count_all_users() === 1` bootstrap decision with a check for no existing
  bootstrap owner.
- Keep the advisory transaction lock.
- Keep `withDataContext` as the transaction/GUC boundary.
- Preserve existing later-user pending behavior once an owner exists.
- Preserve bootstrap audit event behavior for the owner signup.
- Add focused integration tests for the non-empty/no-owner recovery path and regressions.

## Likely Files

- `packages/auth/src/index.ts`
- `tests/integration/auth-settings.test.ts`
- Possibly a narrow helper in an existing module if the check needs to be shared; avoid new
  abstraction unless it clearly improves the code.

## Compact

- Work only in this worktree/branch. Commit green per task. Stage explicit files only.
- Do not touch `docs/coordination/`.
- Do not run repo-wide `pnpm format` unless needed; format/stage only changed files.
- Plan approval comes from the coordinator, not a human gate. Do not code before approval.
- Escalate to `Coordinator` via `herdr-pane-message` for plan-ready, blockers, forks, review, or
  done.
- Never touch the project board, milestones, issue closure, or merge.
- Use a lane-specific DB for DB-touching verification, for example
  `JARVIS_PGDATABASE=jarvis_build_owner260`.
- Use lane-specific logs such as `/tmp/cb-vf-260-owner-bootstrap.log`.
- Security-tier lane: if the plan changes auth/session/RLS semantics beyond the approved owner
  bootstrap rule, tag the escalation `[SECURITY]` and stop for coordinator input.
- Caveman mode for coordinator status/escalations.

## Collision Notes

- #299 provider-model work is separate and out of scope.
- #237 session revoke/list and #239 account deletion are separate and should not be touched here.
- The untracked onboarding Webwright handoff existed before this run; do not stage or edit it.
