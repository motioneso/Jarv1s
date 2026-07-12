# Build Handoff — #853 sign-up hook orphans a better-auth user on failure

**Spec:** none — straightforward bug fix restoring atomicity in `bootstrapFirstJarvisUser`
(`packages/auth/src/index.ts`). No design question, no spec doc required.
**GitHub issue:** #853
**Risk tier:** `security` — modifies auth-account/credential creation atomicity and interacts
directly with the 0055 `users_guard_admin_flag` RLS trigger. This PR gets **adversarial Opus QA +
mandatory Ben merge sign-off** — build to that bar. Do NOT assume CI-green means mergeable.
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/853-auth-signup-atomicity
**Branch:** 853-auth-signup-atomicity (off origin/main @ babe07aa)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/worktrees/853-auth-signup-atomicity/.claude/skills/coordinated-build/SKILL.md
(follow this exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `e56b7c36-6f1b-4438-85ef-bb5cad9eed74` (immutable authority; label is
only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Problem (from the issue)

The first-user bootstrap flow (`bootstrapFirstJarvisUser` in `packages/auth/src/index.ts`) can
create a `better_auth` user/account row and then fail a later step (e.g. `app.users` row creation),
leaving an orphaned auth account with no corresponding application user. Fix: make the multi-step
creation atomic — either wrap in a single transaction, or add compensating cleanup on failure, such
that a partial failure never leaves a dangling better-auth identity. Follow whatever pattern this
codebase already uses for cross-store atomicity (check for an existing transactional helper before
inventing one).

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read the issue (`gh issue view 853`) and the current `bootstrapFirstJarvisUser` implementation
   IN FULL before touching anything.
3. Invoke **`coordinated-build`** and follow it end-to-end: plan → coordinator approval (do NOT
   write code before it) → TDD build (write a failing test that reproduces the orphan first) →
   **`coordinated-wrap-up`** (PR + report). Escalation rules, gate commands, and comms are all
   defined there — this doc does not restate them.
4. Because this is `security` tier: your plan MUST explicitly call out how the fix interacts with
   the 0055 `users_guard_admin_flag` RLS trigger, and your test coverage MUST include the failure
   path (simulate the later step failing and assert no orphaned better-auth row remains).

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt. Never edit an already-applied migration — add a
  new one if schema changes are needed (unlikely for this fix).
- **Do not touch anything sports-related** (`packages/sports/*`) or Park Press/#780 — out of scope.

## Collision notes (from the coordinator)

- No shared table/migration with #663 or #854 — all three are independent and may land in any
  order.
- This PR will NOT auto-merge regardless of CI status — Opus adversarial QA posts its verdict via
  `gh pr comment`, then the coordinator brings it to Ben for explicit sign-off. Build knowing this
  gate exists; it does not change what you build, only how it merges.
