# Build Handoff - rfa-528-memory-graph-substrate

**Spec (approved):** `docs/superpowers/specs/2026-06-26-jarvis-memory-graph-substrate.md`
**GitHub issue:** #528
**Risk tier:** `security`
**Worktree:** `~/Jarv1s/.claude/worktrees/rfa-528-memory-graph-substrate`
**Branch:** `rfa-528-memory-graph-substrate`
**Build provider:** Codex
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f0790-01da-70a2-a013-554a014c24b6`
**Lane database:** `jarvis_build_rfa_528_memory_graph`

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read `CLAUDE.md`, `docs/DEVELOPMENT_STANDARDS.md`, this handoff, and the approved spec in full.
3. Invoke/follow `coordinated-build`: verify spec premises, write plan, message `Coordinator` for
   approval, then stop until approved.
4. Use required agentmemory recalls from `CLAUDE.md`: project state, RLS/shareability, migration
   placement, AccessContext/DataContextDb, integration-test trap.

## Collision Notes

- This is the memory substrate foundation. It precedes #529, #530, #532, #533, #535, #537, #538.
- Security tier: expect independent security QA and Ben merge sign-off. Do not weaken RLS,
  DataContextDb, private-by-default, export/delete, or metadata-only payload invariants.
- Migration ordering is coordinator-owned. Do not assume a global migration number if another lane
  lands first.
- Full gate should use `JARVIS_PGDATABASE=jarvis_build_rfa_528_memory_graph` to avoid shared
  integration reset races.
- Never touch `docs/coordination/` after this handoff commit. Never move board items, close issues,
  or merge. Stage explicit paths only; no `git add -A`.
