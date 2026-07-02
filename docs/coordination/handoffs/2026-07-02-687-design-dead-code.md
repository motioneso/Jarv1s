# Build Handoff — #687 Design Dead Code

**Spec (approved):** GitHub issue #687 is the approved source.
**GitHub issue:** #687
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/687-design-dead-code` **Branch:** `coord/687-design-dead-code`
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f242d-6039-7052-a543-9e2760105800`
**Relay threshold:** countable events — ~80-100k tokens OR a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read issue #687 in full with `gh issue view 687`.
3. Premise-verify every proposed deletion with importer/selector searches on this branch before planning.
4. Invoke `coordinated-build`: write compact plan, escalate to `Coordinator` for approval, then build only after approval.

## Scope Guardrails

- Delete only grep-confirmed dead frontend design code named in #687.
- Do not delete the Today editorial feed path in this lane.
- If a cited file now has importers/usages, report drift and re-scope before editing.
- Do not perform repo-wide formatting.
- Do not touch `docs/coordination/`.
- Stage only files changed for one task at a time; no `git add .`.

## Verification

- Include importer/selector proof in the PR body.
- Run focused build/tests for any touched package plus `pnpm format:check && pnpm lint && pnpm typecheck`.
- Open PR and report PR URL plus exact exit codes to `Coordinator`.
