# Build Handoff - deploy-114-secret-residuals

**Spec (approved):** docs/superpowers/specs/2026-06-18-otnr-p2-secrets-vault-residuals.md
**GitHub issue:** #114
**Risk tier:** `security`
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/deploy-114-secret-residuals
**Branch:** deploy-114-secret-residuals
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

- Chain A successor after #117, now unblocked on `origin/main` `14793b7`.
- Adjacent security/secret surface with #123; keep changes scoped to the P2 credential/vault residuals in the spec.
