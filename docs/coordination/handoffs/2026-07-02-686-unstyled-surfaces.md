# Build Handoff - #686 Unstyled Surfaces

**Spec (approved):** GitHub issue #686 is the approved source.
**GitHub issue:** #686
**Risk tier:** `routine`
**Provider:** Codex
**Worktree:** `~/Jarv1s/.claude/worktrees/686-unstyled-surfaces`
**Branch:** `coord/686-unstyled-surfaces`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2486-7a52-71e3-baad-36300c3f6a9c`
**Relay threshold:** countable events - ~80-100k tokens OR a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read issue #686 in full with `gh issue view 686`.
3. Premise-verify the named unstyled/raw surfaces before planning.
4. Invoke `coordinated-build`: write a compact plan, escalate to `Coordinator` for approval, then build only after approval.

## Scope Guardrails

- Fix only #686 surfaces: chat citation/source tray, memory panel, onboarding OAuth code-paste input, error boundary token styling, and settings activity pane if it stays in that file.
- Use existing JDS/tokens and local row/control families; no new component framework.
- Replace raw error-boundary hex/system-ui styling with CSS variables that survive JS crashes.
- Do not broaden into unrelated settings/chat/onboarding redesign.
- Do not touch `docs/coordination/`.
- Stage only files changed for one task at a time; no `git add .`.

## Verification

- Include focused before/after notes for each accepted surface.
- Run targeted UI/type checks plus `pnpm format:check && pnpm lint && pnpm typecheck`.
- Open PR and report PR URL plus exact exit codes to `Coordinator`.
