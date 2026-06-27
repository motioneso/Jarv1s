# Build Handoff - rfa-526-unified-priority-model

**Spec (approved):** `docs/superpowers/specs/2026-06-27-unified-priority-model.md`
**GitHub issue:** #526
**Risk tier:** `sensitive`
**Worktree:** `~/Jarv1s/.claude/worktrees/rfa-526-unified-priority-model`
**Branch:** `rfa-526-unified-priority-model`
**Build provider:** opencode / GLM (`zai-coding-plan/glm-4.6`)
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f0790-01da-70a2-a013-554a014c24b6`
**Lane database:** `jarvis_build_rfa_526_priority`

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read `CLAUDE.md`, `docs/DEVELOPMENT_STANDARDS.md`, this handoff, and the approved spec in full.
3. Invoke/follow `coordinated-build`: verify spec premises, write plan, message `Coordinator` for
   approval, then stop until approved.
4. Use required agentmemory recalls from `CLAUDE.md`: project state, AccessContext/DataContextDb,
   integration-test trap, frontend workspace query key if UI changes are planned.

## Collision Notes

- This unlocks #527, #531, #535, and #536. Keep the scorer pure; do not create a cross-source
  broker.
- Prefer existing `app.preferences` and existing task/briefing/focus seams. No speculative table
  unless the implementation proves the preference store cannot hold the model.
- Full gate should use `JARVIS_PGDATABASE=jarvis_build_rfa_526_priority` to avoid shared
  integration reset races.
- Never touch `docs/coordination/` after this handoff commit. Never move board items, close issues,
  or merge. Stage explicit paths only; no `git add -A`.
