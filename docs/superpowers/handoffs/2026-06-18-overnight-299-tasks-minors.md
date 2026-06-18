# Build Handoff — overnight-299-tasks-minors

**Spec (approved):** GitHub issue #299 (`Thermo-nuclear review #273: batched minors + 1 design question`)
**GitHub issue:** #299
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/overnight-299-tasks-minors` **Branch:** `overnight-299-tasks-minors`
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019edb62-d2f6-77c0-b451-f8dae62ea049`
**Relay threshold:** countable events — about 80-100k tokens or a compaction summary in your own context.

## Start

1. Resolve your skills. Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute build skill path above and follow it directly.
2. `[ -d node_modules ] || pnpm install`.
3. Read GitHub issue #299 in full with `gh issue view 299`.
4. Invoke the `coordinated-build` skill and follow it: write the plan, escalate it to
   `Coordinator` for approval, then build after approval.

## Scope

This lane is only the #299 tasks mechanical subset. Do not work the #299 design question,
AI/chat bullets, source-behaviors/settings bullets, connectors/infra/scripts bullets,
memory/file-size bullets, or unrelated frontend work.

Allowed bullets:

- Delete dead `filterByQuadrant` in `serialize.ts` if it still has no production callers, plus its
  now-dead test coverage.
- Relevance-check `getQuadrant` in `serialize.ts`. Drop it if it is only a thin forwarding shim to
  `classifyTaskQuadrant`; keep/document it only if it is still a meaningful canonical API.
- Replace `CreateTaskRequest` / `UpdateTaskRequest.recurrence` `Record<string, unknown>` with a
  shared `RecurrenceSpecDto` contract if the current shape still requires it after #297.
- Relevance-check the repository recurrence `occurrence_date` cast/derivation branch. Drop it only
  if it is unreachable after `parseRecurrenceSpec` tightening and tests prove valid recurrence
  semantics still hold.
- Relevance-check `taskUpdateStatusExecute`'s unused `idempotencyKey` manifest parameter. Wire it
  through or drop it from the manifest schema, whichever is mechanically correct after reading the
  route/tool implementation.
- Relevance-check the frontend quadrant mirror. If it can be mechanically shared with the existing
  backend `TASK_QUADRANT_AXES` without widening scope, propose that in the plan; otherwise explicitly
  defer it as a separate frontend/shared-contract slice.

Likely code areas from the coordinator collision scan:

- `packages/tasks/src/serialize.ts`
- `packages/tasks/src/repository.ts`
- `packages/tasks/src/routes.ts`
- `packages/tasks/src/tools.ts` or tasks manifest/tool schema files if the idempotency key lives there
- `packages/shared/src/tasks-api.ts`
- focused tasks tests under `tests/unit/` and `tests/integration/`
- frontend/shared quadrant files only if your approved plan keeps that bullet in scope

## Compact

- Work only in this worktree/branch. Commit green per task. Stage explicit files only.
- Do not touch `docs/coordination/`.
- Do not run repo-wide `pnpm format` or broad `git add`; format/stage only your changed files.
- Plan approval comes from the coordinator, not a human gate. Do not code before approval.
- Escalate to `Coordinator` via `herdr-pane-message` for plan-ready, blocker, design fork, review
  request, or done.
- Never touch the project board, milestones, or merge.
- Honor every `CLAUDE.md` Hard Invariant. No secrets in docs, payloads, logs, or prompts.
- Use a lane-specific DB for DB-touching verification: `JARVIS_PGDATABASE=jarvis_build_tasks299`.
- Use lane-specific log paths such as `/tmp/cb-vf-299-tasks.log`; do not write shared `/tmp/cb-vf.log`.
- Caveman mode for coordinator status/escalations.

## Collision Notes

- #297 has landed in PR #303 (`main @ 2cbea96`) and owns the recurrence JSONB validation boundary.
  Build on current `origin/main`; do not reopen #297's production-code premise.
- #299 infra/settings/scripts is PR #302 and is QA-green but held behind this tasks lane by merge
  order. Avoid touching its files.
- #244 remains held until lower-risk lanes finish.
