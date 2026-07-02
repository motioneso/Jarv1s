# Build Handoff - #684 Design Token Guard

**Spec (approved):** GitHub issue #684 is the approved source.
**GitHub issue:** #684
**Risk tier:** `routine`
**Provider:** `agy` / Gemini
**Worktree:** `~/Jarv1s/.claude/worktrees/684-design-token-guard`
**Branch:** `coord/684-design-token-guard`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2486-7a52-71e3-baad-36300c3f6a9c`
**Relay threshold:** countable events - ~80-100k tokens OR a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read issue #684 in full with `gh issue view 684`.
3. Premise-verify current phantom-token references before planning.
4. Invoke `coordinated-build`: write a compact plan, escalate to `Coordinator` for approval, then build only after approval.

## Scope Guardrails

- Fix only #684 acceptance criteria: canonical replacements for phantom tokens and one undefined-var guard.
- Add the minimum warning/amber token pair only if existing tokens cannot express the role.
- Keep raw token definitions in `apps/web/src/styles/tokens.css`.
- Do not rework component styling beyond replacing undefined variables.
- Do not touch `docs/coordination/`.
- Stage only files changed for one task at a time; no `git add .`.

## Verification

- Include the before/after undefined-token proof in the PR body.
- Add one focused negative check/test for an intentionally undefined var.
- Before wrap-up, run focused token check/test plus `pnpm format:check && pnpm lint && pnpm typecheck`.
- Open PR and report PR URL plus exact exit codes to `Coordinator`.
