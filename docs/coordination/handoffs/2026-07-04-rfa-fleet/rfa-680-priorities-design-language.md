# Build Handoff - rfa-680-priorities-design-language

**Spec (approved):** `docs/superpowers/specs/2026-07-04-priorities-settings-design-language.md`
**GitHub issue:** #680
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/rfa-680-priorities-design-language`
**Branch:** `rfa-680-priorities-design-language`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2b95-774b-7541-870d-eadfd431af47`

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read this handoff and the spec in full.
3. Invoke/follow `coordinated-build`; if the skill is unavailable, follow the same lifecycle:
   inspect current code, write a short plan, send it to `Coordinator`, wait for approval, then build.
4. Before coding, verify the spec premise is still real on this branch.

## Scope

- Make Priorities settings match the existing Settings design language.
- Reuse existing settings primitives and `jds-*` styling.
- Keep priority API/schema/scoring behavior unchanged.

## Collision Limits

- Stay in priority settings UI/design files.
- Do not touch Email, Calendar, Chat, notifications, or `docs/coordination/`.
- Do not run broad repo formatting or `git add -A`.

## Done

- Local focused checks plus `pnpm format:check && pnpm lint && pnpm typecheck`.
- Push branch, open PR for #680, report PR + evidence to `Coordinator`.
- PR needs alternate-model review by AGY/Gemini, not Codex.
