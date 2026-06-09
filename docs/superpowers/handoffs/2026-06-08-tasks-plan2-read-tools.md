# Handoff — M-A5 Tasks Foundation, Plan 2: Assistant READ tools

**From:** Tasks Foundation session (Plan 1 builder). **Date:** 2026-06-08.
**You are:** the "Tasks P2" agent, in worktree `.claude/worktrees/tasks-p2-read-tools`,
branch `feat/tasks-foundation-p2-read-tools` (off `feat/tasks-foundation`, which has Plan 1
+ `main` merged — so PR #33's tool contract is present).

## Where things stand

- Milestone **M-A5 "Tasks Foundation"** = epic **#6** (In Progress), 3 plans.
- **Plan 1** (data model + repository + REST) is **DONE, full-gate green, in PR #35** on
  `feat/tasks-foundation`. Do not redo it. Your branch already contains it.
- `main` (via **PR #33**, coordination **issue #34**) added the **module-owned assistant-tool
  contract**: `ModuleAssistantToolManifest.execute(scopedDb, input, ctx)` + `summarize()` in
  `packages/module-sdk`, dispatched by `AssistantToolGateway` in `packages/ai/src/gateway/`
  (gates by Risk: read→run, write/destructive→confirm; scopes under RLS). Read that code first.

## Your task — Plan 2: READ tools only

Author the Tasks read/query assistant tools as **`execute()` handlers on
`ModuleAssistantToolManifest`** (module-owned, declared + executed in `packages/tasks`),
**NOT** as cases in the legacy central `AiAssistantToolExecutor.invokeReadTool` switch.

Tools to implement (all `risk: "read"`):
- `tasks.list` — filters: list, tag, status, priority, due-range, **matrix quadrant**
- `tasks.get` — incl. subtasks + recent activity
- `tasks.focus`, `tasks.atRisk`, `tasks.overdue` — back by `TaskDriftRepository`
- `tasks.listLists`, `tasks.listTags` — back by `TaskListsRepository`
- `tasks.activity` — a task's activity stream

Back them with the repositories Plan 1 already built (in `packages/tasks/src/`):
`TasksRepository` (repository.ts), `TaskListsRepository` (lists.ts), `TaskBreakdownRepository`
(breakdown.ts), `TaskDriftRepository` (drift.ts), recurrence.ts. Reuse `serializeTask` etc.

**OUT OF SCOPE:** Tasks **write** tools (`tasks.create`/`updateStatus`/`breakDown`/…) — those
are **Phase 2's write surface** (confirm-gated; owned by the Chat-MCP effort). Do not build them.
Also out: web UI (that's Plan 3) and the `TaskStatus` type narrowing (deferred to Plan 3).

## Process — follow the `/start` cadence

1. Run `pnpm install` (fresh worktree — no node_modules), then `pnpm db:up && pnpm db:migrate`
   and `pnpm test:tasks` to confirm a green baseline.
2. Use the **superpowers:writing-plans** skill to write
   `docs/superpowers/plans/2026-06-08-tasks-foundation-plan2-read-tools.md` (bite-sized TDD
   tasks, exact files, green per commit). **PAUSE and get the user's approval before any code.**
3. Build per-task: one **Sonnet** agent per task, each commit green, `git add` only that task's
   files, trailer `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.

## Hard lessons from Plan 1 (do not repeat these)

- **Run the FULL gate before claiming done:** `pnpm verify:foundation` **and**
  `pnpm audit:release-hardening`. Per-suite (`pnpm test:tasks`) green ≠ done — in Plan 1 a
  shared-table change broke *other* suites' raw task seeds; only the full suite caught it.
- **NEVER pipe a gate command to `tail`** (`… | tail`) — the pipe returns tail's exit code and
  masks the real failure. Redirect to a file and capture `$?`: `pnpm verify:foundation > /tmp/x.log 2>&1; echo "EXIT=$?"`.
- **Independently re-verify agent claims.** There is a known intermittent **pg-boss Tasks
  worker-timeout flake** (2 tests in tasks.test.ts time out ~half the runs) — re-run to confirm,
  don't wave failures off as "pre-existing" without an actual passing re-run.

## Coordination

- **Ping the "Chat MCP F2" Herdr agent** (via the herdr-pane-message skill) **before editing
  `packages/module-registry/src/index.ts`** — they're actively in that file on
  `feat/jarvis-chat-phase2-transport`.
- Keep `CONTEXT.md` as the **union** of the Tasks glossary + the assistant/tools glossary
  (Jarvis/Module/Assistant tool/Risk/Action request/Gateway) — already merged; don't drop either.

## References

- Spec: `docs/superpowers/specs/2026-06-08-tasks-foundation-design.md` (rev 3) — see
  §"Assistant-tool contract — READ ONLY this milestone" for the `execute()`-contract direction.
- Plan 1: `docs/superpowers/plans/2026-06-08-tasks-foundation.md`.
- ADR `0004` (tasks single action surface) / ADR `0005` (Phase 2 MCP). Glossary: `CONTEXT.md`.
- GitHub: epic #6, issue #34, PR #33 (contract), PR #35 (Plan 1).

## Start

Begin now: `pnpm install`, read this doc in full, confirm the green baseline, then invoke
`/start` (or the writing-plans skill directly) to draft the Plan 2 read-tools plan and **pause
for the user's approval** before writing any code.
