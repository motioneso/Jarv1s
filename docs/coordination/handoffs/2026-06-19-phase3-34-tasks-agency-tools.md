# Build Handoff — #34 Tasks agency tools

**Spec (approved):** `/home/ben/Jarv1s/docs/superpowers/specs/2026-06-18-tasks-agency-tools.md`
**GitHub issue:** #34
**Risk tier:** `security` (assistant-tool write authority, destructive confirmation policy, actor-scoped task mutation)
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/phase3-34-tasks-agency-tools`
**Branch:** `phase3-34-tasks-agency-tools`
**Build skill path (absolute):** `/home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019ee120-5de0-74f3-ab94-d60368d1aa8e`
**Relay threshold:** relay at ~2/3-3/4 context, after plan approval plus ~5-8 committed tasks, or immediately on compaction.

## Start

1. Confirm skills; if `coordinated-build` does not resolve, read the absolute skill path above.
2. Run `[ -d node_modules ] || pnpm install`.
3. Read the approved spec in full.
4. Use `coordinated-build`: write a plan, send it to `Coordinator` for approval, then wait.

## Compact

- Work only in this worktree and branch.
- Do not touch `docs/coordination/` after reading this handoff.
- Do not write code before coordinator plan approval.
- Stage only your own files.
- Before wrap-up, run focused tests plus `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`; full CI-equivalent gate is coordinator-owned after PR.

## Scope

Implement #34 only:

- gateway policy for auto-running non-destructive `write` tools while keeping destructive tools confirmation-gated;
- task tools listed in the spec, reusing existing task REST/domain APIs and DTO schemas where practical;
- user-facing safe summaries for each mutation;
- tests that normal task writes run without `action_request`, destructive paths require confirmation, owner/RLS boundaries hold, archive is non-destructive, and delete remains destructive.

Out of scope:

- undo UI;
- per-user autonomy settings;
- bulk operations;
- broad task UI redesign;
- #306 deploy checkpoint.

## Pattern Notes

- Follow `packages/tasks/src/manifest.ts` and `packages/tasks/src/tools.ts` for assistant tool shape.
- Follow existing `packages/ai/src/gateway` action-request behavior; do not special-case tasks outside the policy layer.
- No tool accepts `ownerUserId`; use active actor context only.
