# Build Handoff — overnight-299-infra-minors

**Spec (approved):** GitHub issue #299 (`Thermo-nuclear review #273: batched minors + 1 design question`)
**GitHub issue:** #299
**Risk tier:** `routine`
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/overnight-299-infra-minors` **Branch:** `overnight-299-infra-minors`
**Build skill path (absolute):** `/home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019ed994-3159-7961-b750-f5c74c9c5fc3`
**Relay threshold:** countable events — about 80-100k tokens or a compaction summary in your own context.

## Start

1. Resolve your skills. Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute build skill path above and follow it directly.
2. `[ -d node_modules ] || pnpm install`.
3. Read GitHub issue #299 in full with `gh issue view 299`.
4. Invoke the `coordinated-build` skill and follow it: write the plan, escalate it to
   `Coordinator` for approval, then build after approval.

## Scope

This lane is only the #299 infra/settings/scripts mechanical subset. Do not work the #299 design
question, AI/chat bullets, tasks bullets, memory/file-size bullets, or frontend quadrant mirror.

Allowed bullets:

- Extract duplicate `handleSettingsRouteError` from `locale-routes.ts`, `persona-routes.ts`, and
  `source-behavior-routes.ts` into a shared settings route helper.
- Make `SourceBehaviorRoutesDependencies.listModuleManifests` required; remove the silent empty-list
  fallback.
- Decide mechanically whether `SourceBehaviorDefault` `"default-off"` is still justified by a real
  manifest. If no real use exists, propose deletion in the plan before coding; if kept, document it
  where the type is defined and keep tests intentional.
- Relevance-check pg-boss `getOwnedJob` / `cancelOwnedJob`. If kept, add wrong-actor/missing-job
  ownership coverage; if genuinely dead, propose deletion in the plan.
- Add or improve the `createQueue` / `updateQueue` pg-boss rationale if the double-call is still
  needed.
- Relevance-check `settings/src/repository.ts` `recordAuditEvent`. Delete only if truly unused;
  otherwise document why it remains public.
- Add backup/restore password validation mirroring the existing username check.

Likely code areas from the coordinator collision scan:

- `packages/settings/src/locale-routes.ts`
- `packages/settings/src/persona-routes.ts`
- `packages/settings/src/source-behavior-routes.ts`
- `packages/settings/src/repository.ts`
- `packages/jobs/src/pg-boss.ts`
- `scripts/backup-database.ts`
- `scripts/restore-database.ts`
- focused tests in `tests/integration/` or `tests/unit/`

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

- #297 may run in parallel and owns tasks recurrence JSONB. Do not touch tasks recurrence files or
  shared task recurrence contracts.
- #299 tasks remains held until #297 lands.
- #244 remains held until lower-risk lanes finish.
