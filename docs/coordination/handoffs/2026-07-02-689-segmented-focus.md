# Build Handoff - #689 Segmented Focus

**Spec (approved):** GitHub issue #689 is the approved source.
**GitHub issue:** #689
**Risk tier:** `routine`
**Provider:** GLM / opencode (`zai-coding-plan/glm-5.2`)
**Worktree:** `~/Jarv1s/.claude/worktrees/689-segmented-focus`
**Branch:** `coord/689-segmented-focus`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2486-7a52-71e3-baad-36300c3f6a9c`
**Relay threshold:** countable events - ~80-100k tokens OR a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read issue #689 in full with `gh issue view 689`.
3. Premise-verify Calendar/Tasks segmented controls and touched focus-ring selectors before planning.
4. Invoke `coordinated-build`: write a compact plan, escalate to `Coordinator` for approval, then build only after approval.

## Scope Guardrails

- Fix only #689 acceptance criteria: Calendar view toggles use `.jds-segmented`, legacy segmented CSS is removed if empty, touched controls get consistent focus-visible behavior, and off-scale touched weights/radii snap to existing tokens.
- Include `<summary>` in global focus selector only if premise verification shows it is safe.
- Do not build a full `.jds-menu` primitive or migrate every app control.
- GLM/opencode must use `zai-coding-plan/glm-5.2` or higher, never lower.
- Do not touch `docs/coordination/`.
- Stage only files changed for one task at a time; no `git add .`.

## Verification

- Include before/after proof that Calendar and Tasks view switchers share the canonical segmented treatment and no `font-weight: 750` remains from the migrated controls.
- Run focused checks plus `pnpm format:check && pnpm lint && pnpm typecheck`.
- Open PR and report PR URL plus exact exit codes to `Coordinator`.
