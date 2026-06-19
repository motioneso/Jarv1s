# Build Handoff - deploy-236-account-card-real-status

**Spec (approved):** docs/superpowers/specs/2026-06-18-account-card-real-status.md
**GitHub issue:** #236
**Risk tier:** `security`
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/deploy-236-account-card-real-status
**Branch:** deploy-236-account-card-real-status
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019ede13-b12a-7c30-9ad9-5a0bcf5ca85f`
**Relay threshold:** read your own pane usage; relay around 2/3-3/4 consumed, after plan approval plus 5-8 committed tasks, or immediately on compaction summary.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the spec in full.
3. Invoke `coordinated-build`: plan first, send plan to `Coordinator`, wait for approval, then build.
4. Close out with `coordinated-wrap-up`: PR plus compact report to `Coordinator`.

## Compact

- Work only in this worktree/branch.
- Never touch `docs/coordination/`, boards, milestones, or merge controls.
- Do not run repo-wide formatting or broad `git add`; scope formatting/staging to your files.
- Honor `CLAUDE.md` hard invariants. No secrets in docs, logs, prompts, tests, or PR bodies.
- Security tier: expect GLM 5.2 review, Codex security QA/local CI-equivalent evidence, and Ben standing security sign-off rules before merge.

## Collision notes

- Chain C successor after #237 and #230; both are merged into `origin/main` (`#237` squash `14793b7`, `#230` squash `b9e412d`).
- Use the active-sessions surface if it is already present after #237/#230; do not rebuild session revoke/list functionality here.
- #114/#321 remains blocked by a full-gate racer timeout; do not wait on it for this account/session chain item.
