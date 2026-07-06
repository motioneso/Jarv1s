# Build Handoff — rfa-732-settings-data-sources-module-ownership

**Spec (approved):** docs/superpowers/specs/2026-07-04-settings-data-sources-module-ownership.md
**GitHub issue:** #732
**Risk tier:** `sensitive`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-732-settings-data-sources-module-ownership
**Branch:** rfa-732-settings-data-sources-module-ownership off `origin/main@ce249a78`
**Build skill path:** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2c81-005f-73c3-80bc-fd6d568820f7`
**Relay threshold:** countable events — ~80-100k tokens OR a compaction summary in your own context.

## Start

1. Resolve your skills. Confirm you can invoke `coordinated-build` by name; if not, open the build
   skill path above and follow it directly.
2. `pnpm install` only if `node_modules` is missing: `[ -d node_modules ] || pnpm install`.
3. Read the spec above in full.
4. Verify the spec against this branch before planning. This spec was held while #729 landed; related
   Email/Calendar settings and source-context files changed. If any premise has already shipped or
   drifted, escalate to the coordinator with the drift and a re-scoped plan before coding.
5. Invoke `coordinated-build`: write the plan, escalate to the coordinator for approval, build only
   after approval, run the local gate, then close out with `coordinated-wrap-up`.

## Compact

- CI gate: run `pnpm format:check && pnpm lint && pnpm typecheck` plus relevant Vitest coverage and
  record exit codes in your wrap-up report.
- Work only in this worktree/branch. Commit green per task. Stage only task files.
- Plan approval comes from the coordinator, not a human gate. Do not code before plan approval.
- Never touch the project board, milestones, or merge.
- Honor every CLAUDE.md hard invariant. No secrets in docs, payloads, logs, or prompts.
- Caveman mode for coordinator escalations. PR bodies and code stay normal.

## Collision Notes

- #729 / PR #750 is now merged at `ce249a78`. Do not undo live-first Email/Calendar source-context
  behavior, connector-account-scoped email feedback lookup, or the Sync-now removals from personal
  and admin settings.
- #732 previously collided hard with #729 in Email/Calendar settings, manifests, and Email source
  files. Your first plan step must re-read the current merged files and identify what remains to do.
- #721 is active in `rfa-721-chat-priority-context-ranking`, mostly disjoint. Avoid chat routes,
  briefings compose/signals, and priority runtime files unless the spec truly requires them.
- #736 owns Calendar auto-write behavior; #735 owns notification preferences. Do not implement those
  features here.
- Data sources should become Notes-only for this issue; Email/Calendar behavior belongs in module
  settings and mirrored Briefings inclusion controls backed by the same persisted setting.
