# Build Handoff — #683 Design Visible Defects

**Spec (approved):** GitHub issue #683 is the approved source.
**GitHub issue:** #683
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/683-design-visible-defects` **Branch:** `coord/683-design-visible-defects`
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f242d-6039-7052-a543-9e2760105800`
**Relay threshold:** countable events — ~80-100k tokens OR a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read issue #683 in full with `gh issue view 683`.
3. Premise-verify the cited files on this branch before planning.
4. Invoke `coordinated-build`: write compact plan, escalate to `Coordinator` for approval, then build only after approval.

## Scope Guardrails

- Fix only #683 acceptance criteria: visible settings/task select defects, drift red-to-amber, failed-delete toast tone, and Today kicker type role.
- Do not touch #684 phantom-token work; that lane is serialized behind this one.
- Do not perform repo-wide formatting or broad visual cleanup.
- Do not touch `docs/coordination/`.
- Stage only files changed for one task at a time; no `git add .`.

## Verification

- Run focused tests/checks for changed files where available.
- Before wrap-up, run `pnpm format:check && pnpm lint && pnpm typecheck`.
- Open PR and report PR URL plus exact exit codes to `Coordinator`.
