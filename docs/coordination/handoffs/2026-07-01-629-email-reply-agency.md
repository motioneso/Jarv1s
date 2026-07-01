# Build Handoff — 629 Email Reply Agency

**Spec (approved):** `docs/superpowers/specs/2026-06-30-email-agency-slice.md`
**GitHub issue:** #629
**Risk tier:** `security`
**Worktree:** `~/Jarv1s/.claude/worktrees/629-email-reply-agency`
**Branch:** `coord/629-email-reply-agency` off `origin/main` at `fc7d3c3f`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f1c4b-e3c1-7210-99bd-4696b7df1a7d`
**Relay threshold:** countable events — ~80-100k tokens OR a compaction summary in your own context, then relay immediately.

## Start

1. Confirm you can invoke `coordinated-build`; if not, open the build skill path above and follow it directly.
2. Run `[ -d node_modules ] || pnpm install`.
3. Read the spec above IN FULL.
4. Verify the spec against this branch before planning. If any premise has already shipped or drifted, escalate to `Coordinator` with the drift and your re-scoped plan.
5. Invoke `coordinated-build`: write the plan, escalate to coordinator for approval, build only after approval, run the pre-push trio plus targeted tests, then use `coordinated-wrap-up`.

## Non-Negotiables

- Work only in this worktree/branch.
- Do not touch `docs/coordination/`; coordinator-only.
- No repo-wide `pnpm format`; format and stage only changed files.
- No `git add .` or `git add -A`.
- Never touch the project board, milestones, or merge.
- Honor CLAUDE.md hard invariants: DataContextDb only, VaultContext for vault I/O, metadata-only job payloads, no secrets in frontend responses/logs/jobs/exports/prompts, RLS applies to every actor.
- Security-tier PR: expect cross-model adversarial QA and Ben merge sign-off after coordinator verification.
- Caveman mode for coordinator escalations: terse, exact, no filler.

## Collision Notes

- #642 and #652 have landed; build on the current email read cache, scheduler, and permission bridge on `origin/main`.
- Implement replies to cached threads only. The model supplies cached message id plus body; server derives recipient, subject, and thread id from owner-visible cached email.
- `email.sendReply` is destructive and must always confirm. Do not add any setting or family path that can auto-send.
- `email.draftReply` is the only promotable family path (`email_drafts`, default `ask_each_time`, allowed `trusted_auto`).
- The full email body may appear only in the authenticated stream preview and Gmail API call. Do not persist it in action-request rows, audit logs, job payloads, prompts, exports, or logs.
- Keep email writes synchronous; do not introduce pg-boss payloads containing email body content.
- No arbitrary compose, reply-all, attachments, signatures, or edit-before-approve loop in this lane.
