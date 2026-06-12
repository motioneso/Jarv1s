# Build Handoff — audit-slice-a

**Spec (approved):** docs/superpowers/specs/2026-06-11-audit-slice-a-rls-least-priv.md
**Plan:** docs/superpowers/plans/2026-06-11-audit-slice-a-rls-least-priv.md
**GitHub issues:** #97, #98
**Risk tier:** `security` (RLS policies + trigger touching auth surface → cross-model QA + Ben merge sign-off required; build to that bar)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/audit-slice-a **Branch:** audit-slice-a (off origin/main @ d186e01)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label)
**Relay threshold:** ~80–100k tokens OR a compaction summary in your own context (relay immediately).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the absolute **Build skill path** above and follow it directly.
2. `[ -d node_modules ] || pnpm install` — skip if already present (worktrees share pnpm store).
3. Read the **spec** and **plan** above IN FULL before writing a single line of code.
4. Invoke **`coordinated-build`** and follow it: write the implementation plan summary → escalate to the Coordinator for plan approval → on approval, implement TDD/task-by-task → run `pnpm format:check && pnpm lint && pnpm typecheck` + fresh rebase before every push → close out with **`coordinated-wrap-up`** (PR + report).

## Your compact

- Work **only** in this worktree (`/home/ben/Jarv1s/.claude/worktrees/audit-slice-a`). Never touch the shared main tree.
- Commit green per task; `git add` only that task's files. Commit co-author: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
- Plan approval comes from the **Coordinator**, not a human gate. Do not write code before the Coordinator OKs the plan.
- **Escalate to label `Coordinator`** the moment you hit: plan ready for approval, a blocker, a design fork outside the spec, or done (PR open).
- **Never touch** the project board, milestones, or merge — those are the Coordinator's.
- Self-monitor context on countable events. Relay if you hit ~80–100k tokens or see a compaction summary.
- Honor all CLAUDE.md Hard Invariants. No secrets in any doc/log/prompt.
- Caveman mode for all Coordinator escalations (terse, no filler, full technical accuracy).

## What you're building

Two migration-only security fixes (no application code changes):

**#97 — `BEFORE UPDATE` trigger on `app.users`**

- Block non-admin self-escalation of `is_instance_admin`
- Trigger function `app.users_guard_admin_flag()`: raises SQLSTATE 42501 if `NEW.is_instance_admin IS DISTINCT FROM OLD.is_instance_admin AND current_actor_user_id() IS NOT NULL AND NOT current_actor_is_admin()`
- NULL guard is required — preserves bootstrap/migration paths
- Migration goes in `infra/postgres/migrations/`

**#98 — Worker RLS policies on memory tables**

- 9 policies: SELECT/INSERT/UPDATE/DELETE on `memory_chunks`, SELECT/INSERT/UPDATE/DELETE on `memory_file_index`, SELECT on `memory_links` — all `TO jarvis_worker_runtime`, owner_user_id = current_actor_user_id()
- Migration goes in `packages/memory/sql/`

**Migration number assignment:** Determine at build time:

```bash
ls infra/postgres/migrations/*.sql packages/*/sql/*.sql | sed 's|.*/\([0-9]*\)_.*|\1|' | sort -n | tail -1
```

Current high-water = 0052 in this worktree (freshly created off d186e01). Expected next two = 0053 and 0054. Assign sequentially in one build — do NOT pre-assume if main has moved.

## Collision notes

- Slice A is **first on the migration spine**. No other slice is running yet.
- No other agent is on this worktree or branch.
- The plan at `docs/superpowers/plans/2026-06-11-audit-slice-a-rls-least-priv.md` has exact SQL and test code — follow it precisely. Tests go in `tests/integration/auth-settings.test.ts` and `tests/integration/chat-recall.test.ts` (both reference `ids.userA`, `ids.userB`, `ids.adminUser` from `test-database.ts`).
- `connectionStrings.app` = jarvis_app_runtime; `connectionStrings.worker` = jarvis_worker_runtime — both exist in `JarvisDatabaseUrls`.
