# Build Handoff — 1002 Coming-soon G2

**Spec (approved):** `docs/superpowers/specs/2026-07-15-1002-coming-soon-inventory.md`
**Plan (approved):** `docs/superpowers/plans/2026-07-15-1002-coming-soon-inventory.md`
**GitHub issue:** #1002
**Risk tier:** `sensitive` — shared exported UI contract and cross-module call-site change.
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-1002-coming-soon-build`
**Branch:** `ux/1002-coming-soon-build` from `origin/main` `bcdebe01`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `UX Coordinator` — resolve fresh by exact label and session before messaging.
**Coordinator session id:** `019f68a1-899f-7cc1-bba5-2159ae14aaed`
**Relay trigger:** context-meter 70% warning or any compaction summary → message the coordinator,
then invoke `relay` immediately.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read only the approved plan sections for Tasks 2–5 as you execute them; Task 1 is complete.
3. Invoke `coordinated-build`: verify scope → write a compact plan → post the plan pointer to the
PR/issue and request approval from `UX Coordinator` before editing → TDD build →
`coordinated-wrap-up`.

## Locked G2 scope

- Tasks 2–5 only: tracked `ComingSoon`/`Row` contract; delete the dead shell helper; map Audit to
  #1069/#1070 and Push to #743; remove Outlook/Microsoft 365 onboarding promises; correct
  delete-account export copy; update the focused unit/E2E contracts named by the plan.
- No backend, API, migration, capability, or promised-feature implementation.
- Tasks 6–7 are coordinator verification/live evidence. Task 8 is coordinator tracker inventory.
- Keep Tasks 2–5 atomic in one lane: the contract change and three current boolean consumers need
  their mapped call-site changes together for typecheck.

## Run-specific bans

- Work only here. Stage explicit paths; never `git add -A`, `git add .`, or repo-wide format.
- Never touch `docs/coordination/`, project boards, milestones, issue state, or merge.
- Preserve the #1050 priority exports in `packages/settings-ui/src/index.tsx`.
- No secrets, credentials, tokens, export contents, or confirmation values in docs/logs/proof.

## Collision and gate notes

- #1050 is merged and the semantic collision is released. Re-read
  `packages/settings-ui/src/index.tsx` before editing; preserve its newly landed exports.
- G1 trackers #1069, #1070, #743, and #1061 are open. Do not create substitutes.
- Required exact-head live proof is coordinator-owned: real admin session, desktop and 390px,
  keyboard + pointer, truthful tracker mappings, working existing controls, real personal export,
  and cancelled deletion. #988 remains serialized until this PR merges and inventory reconciliation
  finishes.
