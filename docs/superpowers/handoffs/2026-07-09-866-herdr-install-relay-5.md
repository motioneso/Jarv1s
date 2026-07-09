# #866 herdr-install — relay-5 continuation

Spec: `docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md` (approved)
Branch/worktree: `build/866-herdr-install` (this worktree — reuse it, do NOT create a new one)
Coordinator label: `Coordinator` (resolve pane fresh via `herdr pane list`; don't reuse a `…-N`)

## State: plan drafted, sent to Coordinator, awaiting approval. NO CODE WRITTEN YET.

- Plan is done and committed: `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md`
  (commit `cc126a3e`) — 7 TDD tasks, each with complete code, no placeholders, self-review passed.
- Message sent to Coordinator pane (`w1:pC2` at send time — RE-RESOLVE by label, it reflows):
  "plan ready for 866-herdr-install: docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md.
  Approve, or flag a fork. Also relaying now (context 71%) — successor will pick up post-approval build."
- **As of this doc, no reply has been read back yet.** Your first move: check the Coordinator pane
  for a response (approve / fork flag / questions).

## Do NOT re-plan, re-ground, or re-read source files

All grounding is done and captured verbatim in the plan file itself — the plan is self-contained
(every file path, exact current code, exact new code, exact test code for all 7 tasks). Do not
re-read `chat-multiplexer.ts`, `platform-api.ts`, `module-registry/index.ts`, `settings/routes.ts`,
`host-diagnostics-routes.ts`, or `settings-admin-panes.tsx` before starting — the plan already has
everything needed to execute Task 1 verbatim.

## Next steps in order

1. Read the Coordinator's reply (`herdr pane read <Coordinator-pane> --source recent --lines 20`).
2. If approved → proceed straight to Task 1 of the plan via `superpowers:test-driven-development`
   (manual, task-by-task — `executing-plans`/`subagent-driven-development` are disabled in this
   repo per `coordinated-build`). Each task: write failing test → verify fail → implement → verify
   pass → `git add <exact files>` (never `-A`) → commit with `Co-Authored-By: Claude` trailer.
3. If the Coordinator flags a fork/question → answer it, do not unilaterally decide product/
   architecture questions.
4. Before every push: `pnpm format:check && pnpm lint && pnpm typecheck` then
   `git fetch origin main && git rebase origin/main`.
5. Relay again on the next 70% context-meter warning or compaction summary (message Coordinator
   first, then use `relay` skill — this doc is relay-5; next would be relay-6).
6. On completion of all 7 tasks + spec Exit Criteria met → `coordinated-wrap-up` (PR + report only —
   never merge/board/close). Elevated QA at wrap-up: `/security-review` + `/code-review`.

## Bans still in force

- Worktree/branch only as above; explicit `git add <path>`, never `-A`/`.`.
- Never touch `docs/coordination/`.
- No secrets in any doc/payload/log.
- No web API route may install Herdr — hard non-goal (STOP + escalate if the build ever seems to
  need one).
- Never assume a migration number (not applicable to this feature — no migrations touched).
