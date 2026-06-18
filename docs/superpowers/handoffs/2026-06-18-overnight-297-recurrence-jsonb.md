# Build Handoff — overnight-297-recurrence-jsonb

**Spec (approved):** GitHub issue #297 (`[OTNR-P28] Validate recurrence JSONB boundary`)
**GitHub issue:** #297
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/overnight-297-recurrence-jsonb` **Branch:** `overnight-297-recurrence-jsonb`
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019edb62-d2f6-77c0-b451-f8dae62ea049`
**Relay threshold:** countable events — about 80-100k tokens or a compaction summary in your own context.

## Start

1. Resolve your skills. Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute build skill path above and follow it directly.
2. `[ -d node_modules ] || pnpm install`.
3. Read GitHub issue #297 in full with `gh issue view 297`.
4. Invoke the `coordinated-build` skill and follow it: write the plan, escalate it to
   `Coordinator` for approval, then build after approval.

## Scope

Fix only the recurrence JSONB boundary called out in #297:

- Parse and validate persisted JSONB recurrence data into `RecurrenceSpec` once at the boundary.
- Remove the unsafe `as unknown as RecurrenceSpec` style bypass.
- Add focused tests for valid persisted recurrence specs and malformed persisted shapes.
- Preserve existing recurrence scheduling semantics for valid rows.
- Avoid migrations unless a relevance check proves they are necessary.

Likely code areas from the coordinator collision scan:

- `packages/tasks/src/recurrence.ts`
- `packages/tasks/src/repository.ts`
- `packages/tasks/src/routes.ts`
- tasks recurrence tests under `tests/integration/` and `tests/unit/`
- shared task recurrence contract only if the #297 fix proves it is needed

## Compact

- Work only in this worktree/branch. Commit green per task. Stage explicit files only.
- Do not touch `docs/coordination/`.
- Do not run repo-wide `pnpm format` or broad `git add`; format/stage only your changed files.
- Plan approval comes from the coordinator, not a human gate. Do not code before approval.
- Escalate to `Coordinator` via `herdr-pane-message` for plan-ready, blocker, design fork, review
  request, or done.
- Never touch the project board, milestones, or merge.
- Honor every `CLAUDE.md` Hard Invariant. No secrets in docs, payloads, logs, or prompts.
- Caveman mode for coordinator status/escalations.

## Collision Notes

- #299 tasks is held until this lands because it overlaps recurrence/contracts.
- #299 infra may run in parallel and should not touch tasks recurrence files.
- If you discover this needs shared contract changes that would collide with #299 tasks, state that
  in the plan explicitly.
