# Build Handoff — #688 Sports Picker Search

**Spec (approved):** GitHub issue #688 is the approved source.
**GitHub issue:** #688
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/688-sports-picker-search` **Branch:** `coord/688-sports-picker-search`
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f242d-6039-7052-a543-9e2760105800`
**Relay threshold:** countable events — ~80-100k tokens OR a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read issue #688 in full with `gh issue view 688`.
3. Premise-verify the current Sports module settings picker before planning.
4. Invoke `coordinated-build`: write compact plan, escalate to `Coordinator` for approval, then build only after approval.

## Scope Guardrails

- Implement search-first Sports settings picker only.
- Preserve existing follow/unfollow and follow-all-league behavior.
- Avoid changing Sports data-source/server contracts unless premise verification proves the UI cannot work without it; escalate first if so.
- Do not perform repo-wide formatting.
- Do not touch `docs/coordination/`.
- Stage only files changed for one task at a time; no `git add .`.

## Verification

- Add focused tests for search filtering and followed-team summary behavior.
- Run relevant sports/web checks plus `pnpm format:check && pnpm lint && pnpm typecheck`.
- Open PR and report PR URL plus exact exit codes to `Coordinator`.
