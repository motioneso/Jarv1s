# Build Handoff - deploy-230-people-access-sessions

**Spec (approved):** docs/superpowers/specs/2026-06-18-people-access-approval-revoke-sessions.md
**GitHub issue:** #230
**Risk tier:** `security`
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/deploy-230-people-access-sessions
**Branch:** deploy-230-people-access-sessions
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019eddce-2ab2-78f0-88b1-fa5d8295b493`
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
- Security tier: expect adversarial QA and Ben merge sign-off.

## Collision notes

- Chain C successor after #237, now unblocked on `origin/main` `14793b7`.
- #236 waits for this to land; do not build active-session list UI here.
