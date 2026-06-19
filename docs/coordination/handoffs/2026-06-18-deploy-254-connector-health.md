# Build Handoff — deploy-254-connector-health

**Spec (approved):** docs/superpowers/specs/2026-06-18-connector-health-monitoring.md
**GitHub issue:** #254
**Risk tier:** `sensitive`
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/deploy-254-connector-health
**Branch:** deploy-254-connector-health
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019ede31-803b-7dd1-8f59-a6a341df0c3e`
**Relay threshold:** read your own pane with `herdr pane read "$HERDR_PANE_ID" --source visible --lines 5`; relay when context is about 2/3-3/4 consumed, after plan approval plus 5-8 committed tasks, or immediately on compaction.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the spec above in full.
3. Invoke `coordinated-build` and follow it: plan -> coordinator approval -> TDD/green -> pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) -> PR -> coordinated wrap-up.

## Compact

- Work only in this worktree/branch.
- Do not write code before coordinator plan approval.
- Never touch `docs/coordination/`, project boards, milestones, or merge state.
- Use `git add` only for files in your slice.
- Escalate to the `Coordinator` label for plan approval, blockers, design forks, review requests, and done.
- No secrets in docs, payloads, logs, prompts, DTOs, or test fixtures.

## Collision Notes

- #114/#321 is still blocked on a RED full-gate racer timeout despite GLM GREEN. Do not alter #114's secret residuals policy or branch.
- This lane may touch connector account DTOs, sync jobs, migrations, and admin settings UI. Keep stored and displayed health aggregate-only; never persist or expose raw provider responses, tokens, subjects, titles, external IDs, or raw errors.
- Migration numbers are landing-order dependent. Use the repo's current convention from this worktree, then rebase before push.
- CI is unavailable for deploy branches. The coordinator will use a local CI-equivalent QA/gate after PR; your own closeout still needs focused tests plus format/lint/typecheck.
