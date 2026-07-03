# Build Handoff - #685 Neutral Jarvis Glyph

**Spec (approved):** GitHub issue #685 is the approved source.
**GitHub issue:** #685
**Risk tier:** `routine`
**Provider:** Claude
**Worktree:** `~/Jarv1s/.claude/worktrees/685-neutral-jarvis-glyph`
**Branch:** `coord/685-neutral-jarvis-glyph`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2486-7a52-71e3-baad-36300c3f6a9c`
**Relay threshold:** countable events - ~80-100k tokens OR a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read issue #685 in full with `gh issue view 685`.
3. Premise-verify current `Sparkles` imports and bespoke sparkle/starburst marker usage before planning.
4. Invoke `coordinated-build`: write a compact plan, escalate to `Coordinator` for approval, then build only after approval.

## Scope Guardrails

- Fix only #685 acceptance criteria: replace app `Sparkles`/sparkle-starburst AI markers with one neutral Jarvis glyph treatment.
- Prefer an existing neutral icon/mark: `GitCommitHorizontal` for Jarvis-held/generated items, or existing `BrandMark` only where product identity is intended.
- Add a small static check so `Sparkles` cannot return as an app AI marker.
- Do not invent a new icon system or module-specific dialect.
- Do not touch `docs/coordination/`.
- Stage only files changed for one task at a time; no `git add .`.

## Verification

- Include before/after proof that no app UI `Sparkles` imports or bespoke sparkle/starburst markers remain.
- Run the focused static check plus `pnpm format:check && pnpm lint && pnpm typecheck`.
- Open PR and report PR URL plus exact exit codes to `Coordinator`.
