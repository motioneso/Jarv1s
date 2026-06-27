# Build Handoff - RFA #527 Usefulness Feedback

**Spec (approved):** docs/superpowers/specs/2026-06-27-usefulness-feedback-signals.md
**GitHub issue:** #527
**Risk tier:** `security`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-527-usefulness-feedback
**Branch:** rfa-527-usefulness-feedback off origin/main@4e9f128
**Build skill path:** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f0ae5-0afd-7092-911e-6c2e987df7f2`
**Relay threshold:** countable events - ~80-100k tokens OR a compaction summary in your own context.

## Start

1. Resolve `coordinated-build`; if unavailable, read the build skill path above in full.
2. Run `[ -d node_modules ] || pnpm install`.
3. Read the spec in full.
4. Verify the spec against this branch before planning.
5. Write the plan, then escalate to `Coordinator` for approval before coding.

## Compact

- CI gate: local `pnpm format:check && pnpm lint && pnpm typecheck`, focused vitest files, then PR CI.
- Work only in this worktree/branch. Stage explicit paths only. No `git add -A` / `git add .`.
- Never touch docs/coordination, project board, milestones, or merges.
- Honor CLAUDE.md hard invariants: owner-only/RLS, DataContextDb only, no secrets in payloads/logs/prompts/exports.
- Caveman mode for coordinator status/escalations.

## Collision Notes

- Assigned migration slot: `0120_usefulness_feedback_signals.sql`.
- This lands before #532's assigned `0121` slot. Do not renumber unless the coordinator tells you.
- Feedback rows and target registry are metadata-only. No source bodies, chat text, prompts, secrets,
  connector tokens, or raw tool payloads in rows, job payloads, logs, exports, or AI prompts.
- Runtime routes must use owner-scoped DataContextDb and target verifier registry. Do not query
  module-owned tables directly from feedback routes.
- `remember_this` may create only pending memory-review candidates through the #529 intake path;
  it must not silently promote or mutate active memory.
- Export/delete/RLS coverage is part of the security bar.
