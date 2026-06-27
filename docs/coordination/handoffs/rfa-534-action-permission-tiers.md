# Build Handoff - rfa-534-action-permission-tiers

**Spec (approved):** `docs/superpowers/specs/2026-06-27-explicit-action-permission-tiers.md`
**GitHub issue:** #534
**Risk tier:** `security`
**Worktree:** `~/Jarv1s/.claude/worktrees/rfa-534-action-permission-tiers`
**Branch:** `rfa-534-action-permission-tiers`
**Build provider:** AGY
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f0790-01da-70a2-a013-554a014c24b6`
**Lane database:** `jarvis_build_rfa_534_action_permissions`

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read `CLAUDE.md`, `docs/DEVELOPMENT_STANDARDS.md`, this handoff, and the approved spec in full.
3. Invoke/follow `coordinated-build`: verify spec premises, write plan, message `Coordinator` for
   approval, then stop until approved.
4. Use required agentmemory recalls from `CLAUDE.md`: project state, RLS/shareability if policies
   change, AccessContext/DataContextDb, integration-test trap, frontend workspace query key for UI.

## Collision Notes

- This unlocks action-policy parts of #535, #536, and #537. Reuse `AssistantToolGateway`,
  `resolvePolicy`, action requests, and existing module manifest risk/execution policy fields.
- Do not add a second executor, global automation switch, or a path that bypasses confirmation for
  destructive/external-send actions.
- Security tier: expect independent security QA and Ben merge sign-off.
- Full gate should use `JARVIS_PGDATABASE=jarvis_build_rfa_534_action_permissions` to avoid shared
  integration reset races.
- Never touch `docs/coordination/` after this handoff commit. Never move board items, close issues,
  or merge. Stage explicit paths only; no `git add -A`.
